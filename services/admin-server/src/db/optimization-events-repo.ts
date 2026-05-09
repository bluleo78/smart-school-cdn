import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { clampInt, clampOffset } from './pagination.js';

/**
 * optimization_events 테이블 스키마.
 * Phase 13(미디어 Range) / Phase 14(이미지 Optimizer) / Phase 15(텍스트 압축)가
 * 공용으로 사용하며, event_type 컬럼으로 세 Phase를 구분한다.
 *
 * - url_hash: SHA-256 앞 16자 — 동일 URL 그룹핑·인덱스 정렬 효율용 (insert 시 자동 계산)
 * - decision: 처리 결과 분류 문자열. Phase별로 의미가 다르지만 고정 집합으로 운영한다.
 *   · media_cache:   'served_200','served_206','stored_new','invalid_range_416'
 *   · image_optimize:'converted','rejected_size','skipped_small','skipped_type','error'
 *   · text_compress: 'compressed_br','compressed_gzip','skipped_small','skipped_type','error'
 *   · (공통 bypass): 'bypass_nocache','bypass_size','bypass_method','bypass_other'
 * - orig_size / out_size: null 허용 (예: bypass 케이스는 out_size 없음)
 */
export const OPTIMIZATION_EVENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS optimization_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    host         TEXT NOT NULL,
    url_hash     TEXT NOT NULL,
    url          TEXT NOT NULL,
    decision     TEXT NOT NULL,
    orig_size    INTEGER,
    out_size     INTEGER,
    range_header TEXT,
    content_type TEXT,
    elapsed_ms   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_opt_events_host_ts       ON optimization_events(host, ts);
  CREATE INDEX IF NOT EXISTS idx_opt_events_type_decision ON optimization_events(event_type, decision);
  CREATE INDEX IF NOT EXISTS idx_opt_events_ts            ON optimization_events(ts);
  -- (#378) UI 의 'WHERE event_type = ? ORDER BY ts DESC LIMIT N' 패턴(host 미지정)은
  -- 기존 인덱스 중 어느 것도 ORDER BY ts 정렬을 만족시키지 못해 SQLite 가 TEMP B-TREE 로
  -- 정렬을 수행한다. (event_type, ts) 복합 인덱스를 추가하여 정렬용 임시 인덱스 없이
  -- 인덱스 스캔만으로 응답하도록 한다. idempotent 하므로 기존 DB 에도 안전 적용.
  CREATE INDEX IF NOT EXISTS idx_opt_events_type_ts       ON optimization_events(event_type, ts);
`;

/** 허용 event_type — 라우트/repo 양쪽에서 검증에 사용 */
export type OptimizationEventType = 'media_cache' | 'image_optimize' | 'text_compress';

/** 단일 이벤트 입력 타입 — url_hash는 insert 시 자동 계산되므로 제외 */
export interface OptimizationEventInput {
  /** ISO8601 UTC — 미지정 시 repo가 현재 시각을 채움 */
  ts?: string;
  event_type: OptimizationEventType;
  host: string;
  url: string;
  decision: string;
  orig_size?: number | null;
  out_size?: number | null;
  range_header?: string | null;
  content_type?: string | null;
  elapsed_ms: number;
}

/** 조회 결과 row */
export interface OptimizationEventRow {
  id: number;
  ts: string;
  event_type: string;
  host: string;
  url_hash: string;
  url: string;
  decision: string;
  orig_size: number | null;
  out_size: number | null;
  range_header: string | null;
  content_type: string | null;
  elapsed_ms: number;
}

/** statsByDecision 반환 row */
export interface DecisionStatsRow {
  decision: string;
  count: number;
  total_orig: number;
  total_out: number;
  avg_elapsed_ms: number;
}

export interface EventsQuery {
  event_type?: string;
  host?: string;
  decision?: string;
  /** 이 ts 이후(>=)만 포함. ISO8601. 미지정 시 전체 */
  since?: string;
  /** 반환 개수 상한. 기본 100, 상한 1000 */
  limit?: number;
}

export interface StatsQuery {
  event_type?: string;
  host?: string;
  /** 집계 기간 초. 기본 86400(24h) */
  period_sec?: number;
}

/** url → SHA-256 앞 16자 — 인덱스 정렬 효율을 위해 고정 길이 hex로 저장 */
function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * LIKE 패턴에서 SQL 와일드카드 문자를 이스케이프한다.
 * `%`, `_`, `\` 를 `\` 로 이스케이프하여 리터럴 문자열 검색이 되도록 한다.
 * SQL 쿼리에서는 반드시 `ESCAPE '\'` 절과 함께 사용해야 한다.
 */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * 최적화 이벤트 리포지토리.
 * proxy가 배치 push한 이벤트 레코드를 저장·조회·정리한다.
 */
export class OptimizationEventsRepository {
  constructor(private readonly db: Database.Database) {}

  /** 단일 이벤트 insert — ts 미지정 시 현재 시각, size/range/ct 미지정 시 null로 저장 */
  insert(ev: OptimizationEventInput): void {
    this.db
      .prepare(
        `INSERT INTO optimization_events
           (ts, event_type, host, url_hash, url, decision, orig_size, out_size, range_header, content_type, elapsed_ms)
         VALUES
           (@ts, @event_type, @host, @url_hash, @url, @decision, @orig_size, @out_size, @range_header, @content_type, @elapsed_ms)`,
      )
      .run({
        ts:           ev.ts ?? new Date().toISOString(),
        event_type:   ev.event_type,
        host:         ev.host,
        url_hash:     hashUrl(ev.url),
        url:          ev.url,
        decision:     ev.decision,
        orig_size:    ev.orig_size ?? null,
        out_size:     ev.out_size ?? null,
        range_header: ev.range_header ?? null,
        content_type: ev.content_type ?? null,
        elapsed_ms:   ev.elapsed_ms,
      });
  }

  /**
   * 배치 insert — 단일 트랜잭션으로 감싸 성능·원자성을 확보한다.
   * 반환값: 성공적으로 처리된 이벤트 개수.
   */
  insertBatch(events: OptimizationEventInput[]): number {
    if (events.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT INTO optimization_events
         (ts, event_type, host, url_hash, url, decision, orig_size, out_size, range_header, content_type, elapsed_ms)
       VALUES
         (@ts, @event_type, @host, @url_hash, @url, @decision, @orig_size, @out_size, @range_header, @content_type, @elapsed_ms)`,
    );
    const insertAll = this.db.transaction((batch: OptimizationEventInput[]) => {
      for (const ev of batch) {
        stmt.run({
          ts:           ev.ts ?? new Date().toISOString(),
          event_type:   ev.event_type,
          host:         ev.host,
          url_hash:     hashUrl(ev.url),
          url:          ev.url,
          decision:     ev.decision,
          orig_size:    ev.orig_size ?? null,
          out_size:     ev.out_size ?? null,
          range_header: ev.range_header ?? null,
          content_type: ev.content_type ?? null,
          elapsed_ms:   ev.elapsed_ms,
        });
      }
    });
    insertAll(events);
    return events.length;
  }

  /**
   * 필터 조건에 맞는 최근 이벤트를 ts 내림차순으로 반환.
   * limit는 1~1000 범위로 클램프, 기본 100.
   */
  query(q: EventsQuery = {}): OptimizationEventRow[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (q.event_type) { where.push('event_type = @event_type'); params.event_type = q.event_type; }
    if (q.host)       { where.push('host = @host');             params.host       = q.host; }
    if (q.decision)   { where.push('decision = @decision');     params.decision   = q.decision; }
    if (q.since)      { where.push('ts >= @since');             params.since      = q.since; }

    // limit는 1~1000 정수로 강제 — 비정수 입력(예: 1.7)이 SQL `LIMIT`에 그대로 주입되어
    // SQLITE_MISMATCH로 500이 되는 회귀(#293)를 차단하기 위해 clampInt로 정수화한다.
    const limit = clampInt(q.limit, { min: 1, max: 1000, fallback: 100 });
    const sql = `
      SELECT id, ts, event_type, host, url_hash, url, decision,
             orig_size, out_size, range_header, content_type, elapsed_ms
      FROM optimization_events
      ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ts DESC
      LIMIT ${limit}
    `;
    return this.db.prepare(sql).all(params) as OptimizationEventRow[];
  }

  /**
   * decision별 집계 통계.
   * period_sec 초 이내 이벤트에 대해 건수·바이트 합·평균 elapsed_ms를 계산한다.
   */
  statsByDecision(q: StatsQuery = {}): DecisionStatsRow[] {
    const periodSec = q.period_sec ?? 86400;
    const since = new Date(Date.now() - periodSec * 1000).toISOString();

    const where: string[] = ['ts >= @since'];
    const params: Record<string, string> = { since };
    if (q.event_type) { where.push('event_type = @event_type'); params.event_type = q.event_type; }
    if (q.host)       { where.push('host = @host');             params.host       = q.host; }

    const sql = `
      SELECT
        decision,
        COUNT(*)                           AS count,
        COALESCE(SUM(orig_size), 0)        AS total_orig,
        COALESCE(SUM(out_size),  0)        AS total_out,
        COALESCE(AVG(elapsed_ms), 0)       AS avg_elapsed_ms
      FROM optimization_events
      WHERE ${where.join(' AND ')}
      GROUP BY decision
      ORDER BY count DESC
    `;
    const rows = this.db.prepare(sql).all(params) as Array<{
      decision: string; count: number; total_orig: number; total_out: number; avg_elapsed_ms: number;
    }>;
    return rows.map((r) => ({
      decision:       r.decision,
      count:          r.count,
      total_orig:     r.total_orig,
      total_out:      r.total_out,
      avg_elapsed_ms: Math.round(r.avg_elapsed_ms),
    }));
  }

  /** 기준 시각(ISO8601) 이전 이벤트 삭제. 삭제된 행 수 반환 */
  prune(beforeIso: string): number {
    return this.db.prepare(`DELETE FROM optimization_events WHERE ts < ?`).run(beforeIso).changes;
  }

  /**
   * (#379) `domains` 테이블에 더 이상 존재하지 않는 host 의 orphan 이벤트를 정리한다.
   * `optimization_events.host` 에는 FK 제약이 없어 라우트 외 경로(직접 SQL·외부 도구·시드 누락 등)
   * 로 도메인이 삭제되면 해당 host 의 이벤트 행이 그대로 잔존한다.
   * 주기적 reconcile 로 잠재적 누수 경로를 안전하게 회수한다 (low-risk option).
   * 삭제된 행 수를 반환한다.
   */
  reconcileOrphans(): number {
    return this.db
      .prepare(
        `DELETE FROM optimization_events
         WHERE host NOT IN (SELECT host FROM domains)`,
      )
      .run().changes;
  }

  /**
   * 특정 호스트의 모든 이벤트 삭제. 삭제된 행 수 반환.
   * 도메인 삭제 시 orphan optimization_events 누적을 방지하기 위해 사용한다 (#185).
   * `optimization_events` 테이블에는 FK 제약이 없어 CASCADE가 동작하지 않으므로
   * 라우트 레벨에서 명시적으로 호출해 정리한다.
   */
  deleteByHost(host: string): number {
    return this.db.prepare(`DELETE FROM optimization_events WHERE host = ?`).run(host).changes;
  }

  /**
   * 여러 호스트의 이벤트 일괄 삭제. 삭제된 행 수 반환.
   * 도메인 bulkDelete 경로에서 사용하며, 단일 트랜잭션으로 묶어 원자성을 확보한다 (#185).
   */
  deleteByHosts(hosts: string[]): number {
    if (hosts.length === 0) return 0;
    const placeholders = hosts.map(() => '?').join(', ');
    return this.db
      .prepare(`DELETE FROM optimization_events WHERE host IN (${placeholders})`)
      .run(...hosts).changes;
  }

  /** Phase 16-3: URL별 최적화 집계.
   *  선택 기간 내 host 이벤트를 URL 기준으로 GROUP BY 하여
   *  이벤트 수·원본 합·최적화 후 합·decision 리스트(쉼표 구분)를 반환한다.
   *  정렬은 호출자가 지정 — 기본은 savings_ratio DESC. */
  urlBreakdown(q: {
    host: string;
    period_sec?: number;
    sort?: 'savings' | 'orig_size' | 'events';
    decision?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): {
    total: number;
    items: Array<{
      url: string;
      events: number;
      total_orig: number;
      total_out: number;
      savings_ratio: number;
      decisions: string;
    }>;
  } {
    const periodSec = q.period_sec ?? 86400;
    const since = new Date(Date.now() - periodSec * 1000).toISOString();
    const where: string[] = ['host = @host', 'ts >= @since'];
    const params: Record<string, string> = { host: q.host, since };
    if (q.decision) { where.push('decision = @decision'); params.decision = q.decision; }
    // LIKE 특수문자(%, _, \)를 이스케이프하여 리터럴 검색을 보장한다
    if (q.search)   { where.push(`url LIKE @q ESCAPE '\\'`); params.q = `%${escapeLike(q.search)}%`; }

    // limit/offset 정수화 — #293과 동일한 SQLITE_MISMATCH 방지 (#294 라우트도 이 경로 공유)
    const limit  = clampInt(q.limit, { min: 1, max: 500, fallback: 50 });
    const offset = clampOffset(q.offset);

    // skipped_*/bypass_* 이벤트는 out_size가 NULL — 실제로는 압축/변환을 안 한 것이므로
    // 원본 그대로 전달된 것으로 간주해 out_size를 orig_size로 대체한다.
    // 그대로 SUM(out_size)로 집계하면 NULL→0이 되어 savings가 100%로 과대 표시된다.
    const effectiveOut = 'COALESCE(out_size, orig_size)';
    const sortSql = ({
      savings:   `(1.0 - (CAST(COALESCE(SUM(${effectiveOut}),0) AS REAL) / NULLIF(SUM(orig_size),0))) DESC`,
      orig_size: "SUM(orig_size) DESC",
      events:    "COUNT(*) DESC",
    } as const)[q.sort ?? 'savings'];

    const base = `FROM optimization_events WHERE ${where.join(' AND ')} GROUP BY url`;
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM (SELECT url ${base})`)
      .get(params) as { c: number };

    const rows = this.db.prepare(`
      SELECT
        url,
        COUNT(*)                                AS events,
        COALESCE(SUM(orig_size), 0)             AS total_orig,
        COALESCE(SUM(${effectiveOut}), 0)       AS total_out,
        GROUP_CONCAT(DISTINCT decision)         AS decisions
      ${base}
      ORDER BY ${sortSql}
      LIMIT ${limit} OFFSET ${offset}
    `).all(params) as Array<{
      url: string; events: number; total_orig: number; total_out: number; decisions: string;
    }>;

    return {
      total: totalRow.c,
      items: rows.map((r) => ({
        url: r.url,
        events: r.events,
        total_orig: r.total_orig,
        total_out: r.total_out,
        savings_ratio: r.total_orig > 0 ? 1 - r.total_out / r.total_orig : 0,
        decisions: r.decisions ?? '',
      })),
    };
  }
}
