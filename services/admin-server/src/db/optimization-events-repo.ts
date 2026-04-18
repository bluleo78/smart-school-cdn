import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

/**
 * optimization_events 테이블 스키마.
 * Phase 13(미디어 Range) / Phase 14(이미지 Optimizer) / Phase 15(텍스트 압축)가
 * 공용으로 사용하며, event_type 컬럼으로 세 Phase를 구분한다.
 *
 * - url_hash: SHA-256 앞 16자 — 동일 URL 그룹핑·인덱스 정렬 효율용 (insert 시 자동 계산)
 * - decision: 처리 결과 분류 문자열. Phase별로 의미가 다르지만 고정 집합으로 운영한다.
 *   · media_cache:   'served_200','served_206','stored_new','invalid_range_416'
 *   · image_optimize:'converted','rejected_size','skipped_small','skipped_type','error'
 *   · text_compress: 'compressed_br','compressed_gzip','skipped_small','skipped_type'
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

    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
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
}
