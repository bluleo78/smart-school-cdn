import type { Database } from 'better-sqlite3';

/**
 * 프록시 대상 도메인 테이블 스키마
 * - host: 클라이언트 요청의 Host 헤더 값 (PK)
 * - origin: 실제로 중계할 원본 서버 URL
 * - enabled: 도메인 활성화 여부 (1=활성, 0=비활성)
 * - description: 도메인 설명
 * - created_at: 등록 시각
 * - updated_at: 마지막 수정 시각
 */
export const DOMAIN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS domains (
    host                  TEXT PRIMARY KEY,
    origin                TEXT NOT NULL,
    enabled               INTEGER NOT NULL DEFAULT 1,
    description           TEXT NOT NULL DEFAULT '',
    created_at            INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at            INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    -- 이슈 #429 — 도메인별 stale-if-error 윈도우(초). NULL=글로벌 폴백, 0=비활성, >0=명시 윈도우.
    stale_if_error_secs   INTEGER
  );
`;

/** 도메인 한 건을 표현하는 타입 */
export interface Domain {
  host: string;
  origin: string;
  enabled: number;
  description: string;
  created_at: number;
  updated_at: number;
  /**
   * 이슈 #429 — 도메인별 stale-if-error 윈도우(초).
   * null: 글로벌 PROXY_STALE_IF_ERROR_SECS 사용 / 0: 비활성 / >0: 해당 도메인 전용 윈도우.
   */
  stale_if_error_secs: number | null;
}

/** findAll 검색/필터 옵션 */
export interface FindAllOptions {
  /** host 또는 origin 부분 일치 검색 */
  q?: string;
  /** 활성화 여부 필터 */
  enabled?: boolean;
  /** 정렬 기준 컬럼 (기본값: created_at) */
  sort?: string;
  /** 정렬 방향 — 'asc' | 'desc' (기본값: desc) */
  order?: string;
  /**
   * 페이지네이션 LIMIT (#199) — 양의 정수만 적용. undefined/0 이하면 전체 반환(기존 동작 유지).
   * 호출자(라우트)에서 음수/NaN 클램프 후 전달한다.
   */
  limit?: number;
  /**
   * 페이지네이션 OFFSET (#199) — 0 이상 정수만 적용. limit 없이 단독 지정 시 SQLite는 OFFSET을 적용하려면
   * LIMIT가 필수이므로, offset만 들어오면 LIMIT -1(무제한 의미)로 보정해 OFFSET이 동작하도록 한다.
   */
  offset?: number;
}

/**
 * LIKE 패턴에서 SQL 와일드카드 문자를 이스케이프한다.
 * `%`, `_`, `\` 를 `\` 로 이스케이프하여 리터럴 문자열 검색이 되도록 한다.
 * SQL 쿼리에서는 반드시 `ESCAPE '\'` 절과 함께 사용해야 한다.
 */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** sort 화이트리스트 — SQL injection 방지 */
const SORT_WHITELIST = new Set(['host', 'created_at', 'updated_at']);

/** order 화이트리스트 — 허용된 방향만 허용하여 SQL injection 방지 */
const ORDER_WHITELIST = new Set(['asc', 'desc']);

/**
 * 도메인 매핑 리포지토리
 * 생성자로 DB 커넥션을 주입받아 테스트에서 쉽게 교체할 수 있도록 한다.
 */
export class DomainRepository {
  constructor(private readonly db: Database) {}

  /** DB 인스턴스 접근용 getter — 외부에서 직접 쿼리가 필요할 때 사용 */
  get database(): Database { return this.db; }

  /** 도메인 등록 (이미 있으면 origin, description, updated_at 갱신) */
  upsert(host: string, origin: string, description?: string): void {
    this.db
      .prepare(
        `INSERT INTO domains (host, origin, description) VALUES (?, ?, ?)
         ON CONFLICT(host) DO UPDATE SET
           origin = excluded.origin,
           description = excluded.description,
           updated_at = strftime('%s', 'now')`,
      )
      .run(host, origin, description ?? '');
  }

  /**
   * 부팅 시드 전용 등록 (#375)
   * - 무엇을: 동일 host가 없을 때만 INSERT 하고, 이미 존재하면 아무것도 하지 않는다.
   * - 왜: admin-server 부팅 시 기본 도메인 시드가 매 재시작마다 사용자가 편집한
   *   origin/description/updated_at 을 덮어쓰는 데이터 손실 버그를 막기 위함.
   *   기존 `upsert()` 는 ON CONFLICT DO UPDATE 정책이라 신규 등록과 강제 갱신 의도가 섞여 있어
   *   "없으면 추가" 시멘틱을 표현하지 못한다.
   * - 동작: `INSERT ... ON CONFLICT(host) DO NOTHING` — bulkInsert 와 동일한 보존 정책.
   */
  seedIfMissing(host: string, origin: string, description?: string): void {
    this.db
      .prepare(
        `INSERT INTO domains (host, origin, description) VALUES (?, ?, ?)
         ON CONFLICT(host) DO NOTHING`,
      )
      .run(host, origin, description ?? '');
  }

  /** 호스트로 단건 조회 — 없으면 undefined */
  findByHost(host: string): Domain | undefined {
    return this.db
      .prepare(
        `SELECT host, origin, enabled, description, created_at, updated_at, stale_if_error_secs
         FROM domains WHERE host = ?`,
      )
      .get(host) as Domain | undefined;
  }

  /**
   * 목록 조회 — 검색·필터·정렬 지원
   * - q: host 또는 origin 부분 일치 (LIKE)
   * - enabled: boolean → 1/0 변환하여 필터
   * - sort: 정렬 컬럼 (화이트리스트 검증, 기본 created_at DESC)
   */
  findAll(options?: FindAllOptions): Domain[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options?.q) {
      // LIKE 특수문자(%, _, \)를 이스케이프하여 리터럴 검색을 보장한다
      conditions.push(`(host LIKE ? ESCAPE '\\' OR origin LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(options.q)}%`;
      params.push(like, like);
    }

    if (options?.enabled !== undefined) {
      conditions.push(`enabled = ?`);
      params.push(options.enabled ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // sort/order 화이트리스트 검증 — 허용되지 않은 값은 기본값으로 대체하여 SQL injection 방지
    const sortCol = options?.sort && SORT_WHITELIST.has(options.sort) ? options.sort : 'created_at';
    const sortDir = options?.order && ORDER_WHITELIST.has(options.order.toLowerCase())
      ? options.order.toUpperCase()
      : 'DESC';
    const orderBy = `ORDER BY ${sortCol} ${sortDir}`;

    // limit/offset (#199) — 양의 정수만 적용. limit 미지정 + offset 지정 시 SQLite는 OFFSET을
    // LIMIT 없이 받지 않으므로 LIMIT -1(무제한 의미)을 함께 넘긴다.
    const hasLimit  = typeof options?.limit  === 'number' && Number.isFinite(options.limit)  && options.limit  > 0;
    const hasOffset = typeof options?.offset === 'number' && Number.isFinite(options.offset) && options.offset > 0;
    let pagination = '';
    if (hasLimit && hasOffset) {
      pagination = 'LIMIT ? OFFSET ?';
      params.push(Math.floor(options!.limit!), Math.floor(options!.offset!));
    } else if (hasLimit) {
      pagination = 'LIMIT ?';
      params.push(Math.floor(options!.limit!));
    } else if (hasOffset) {
      // LIMIT -1: SQLite에서 "무제한"으로 동작하여 OFFSET만 적용 가능
      pagination = 'LIMIT -1 OFFSET ?';
      params.push(Math.floor(options!.offset!));
    }

    return this.db
      .prepare(
        `SELECT host, origin, enabled, description, created_at, updated_at, stale_if_error_secs
         FROM domains ${where} ${orderBy} ${pagination}`,
      )
      .all(...params) as Domain[];
  }

  /**
   * 도메인 필드 부분 업데이트
   * - 변경된 필드만 SET, updated_at 자동 갱신
   * - 존재하지 않으면 undefined 반환
   */
  update(
    host: string,
    data: {
      origin?: string;
      enabled?: number;
      description?: string;
      /** 이슈 #429 — null 명시 시 글로벌 폴백으로 복귀. undefined 는 변경 없음. */
      stale_if_error_secs?: number | null;
    },
  ): Domain | undefined {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

    if (data.origin !== undefined) {
      sets.push('origin = ?');
      params.push(data.origin);
    }
    if (data.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(data.enabled);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description);
    }
    if (data.stale_if_error_secs !== undefined) {
      sets.push('stale_if_error_secs = ?');
      params.push(data.stale_if_error_secs);
    }

    if (sets.length === 0) return this.findByHost(host);

    sets.push(`updated_at = strftime('%s', 'now')`);
    params.push(host);

    const result = this.db
      .prepare(`UPDATE domains SET ${sets.join(', ')} WHERE host = ?`)
      .run(...params);

    if (result.changes === 0) return undefined;
    return this.findByHost(host);
  }

  /**
   * 도메인 활성화/비활성화 토글
   * - CASE WHEN으로 현재 값의 반대값으로 전환
   * - 존재하지 않으면 undefined 반환
   */
  toggleEnabled(host: string): Domain | undefined {
    const result = this.db
      .prepare(
        `UPDATE domains
         SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END,
             updated_at = strftime('%s', 'now')
         WHERE host = ?`,
      )
      .run(host);

    if (result.changes === 0) return undefined;
    return this.findByHost(host);
  }

  /**
   * 도메인 일괄 등록 (#197)
   * - 무엇을: 신규 host만 INSERT 하고, 이미 존재하는 host는 origin을 보존하여 `skipped`로 분류한다.
   * - 왜: 기존 upsert 동작은 사용자 안내 없이 origin을 덮어써 의도치 않은 라우팅 변경을 일으켰다.
   *   안전 우선 정책으로, 기존 host는 명시적 갱신(PUT) 경로를 통해서만 변경되도록 한다.
   * - 동작: `INSERT ... ON CONFLICT(host) DO NOTHING` 후 `result.changes`로 신규/스킵을 판별.
   * - 개별 SQL 실패는 `failed`로 수집하여 나머지 행은 계속 처리한다.
   */
  bulkInsert(
    domains: Array<{ host: string; origin: string }>,
  ): {
    added: number;
    skipped: Array<{ host: string; existingOrigin: string }>;
    failed: Array<{ host: string; error: string }>;
  } {
    const skipped: Array<{ host: string; existingOrigin: string }> = [];
    const failed: Array<{ host: string; error: string }> = [];
    let added = 0;

    // ON CONFLICT DO NOTHING 으로 기존 host 보존 (#197). updated_at 도 유지된다.
    const insertStmt = this.db.prepare(
      `INSERT INTO domains (host, origin) VALUES (?, ?)
       ON CONFLICT(host) DO NOTHING`,
    );
    // skipped 분류 시 사용자에게 기존 origin을 안내하기 위한 조회 — 트랜잭션 내에서 동기 실행
    const findStmt = this.db.prepare(
      `SELECT origin FROM domains WHERE host = ?`,
    );

    const runAll = this.db.transaction(() => {
      for (const { host, origin } of domains) {
        try {
          const result = insertStmt.run(host, origin);
          if (result.changes === 0) {
            // 기존 host — 사용자 안내용으로 현재 저장된 origin 같이 반환
            const row = findStmt.get(host) as { origin: string } | undefined;
            skipped.push({ host, existingOrigin: row?.origin ?? '' });
          } else {
            added++;
          }
        } catch (err) {
          failed.push({
            host,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    runAll();
    return { added, skipped, failed };
  }

  /**
   * 도메인 일괄 삭제 (#212)
   * - IN 절로 여러 호스트를 한 번에 삭제
   * - 부분 실패(요청 N건 vs 실제 삭제 M건) 안내를 위해 삭제 전 SELECT로 실재 호스트를 확인하여
   *   `missing` 목록(요청에는 있으나 DB에 없는 호스트)을 함께 계산해 반환한다.
   * - 동일한 host가 중복으로 들어와도 missing 판정 시에는 중복을 제거해 비교한다.
   */
  bulkDelete(hosts: string[]): { deleted: number; missing: string[] } {
    if (hosts.length === 0) return { deleted: 0, missing: [] };

    // 비문자열/빈 호스트는 매칭 자체가 불가하므로 missing 판정에서 제외하지 않고
    // 요청 그대로(중복 제거 후) 비교 — UI에는 어떤 항목이 누락됐는지 그대로 알린다.
    const uniqueHosts = Array.from(new Set(hosts));
    const placeholders = uniqueHosts.map(() => '?').join(', ');

    // 삭제 직전 매칭되는 host 목록을 먼저 SELECT — 트랜잭션 없이도 동일 prepare 직후 실행하므로
    // 외부 세션의 동시 삭제 영향은 미미. 우리는 "이 요청 시점에 DB에 없던 host"만 missing 으로 보고한다.
    const presentRows = this.db
      .prepare(`SELECT host FROM domains WHERE host IN (${placeholders})`)
      .all(...uniqueHosts) as Array<{ host: string }>;
    const presentSet = new Set(presentRows.map((r) => r.host));
    const missing = uniqueHosts.filter((h) => !presentSet.has(h));

    const deleted = this.db
      .prepare(`DELETE FROM domains WHERE host IN (${placeholders})`)
      .run(...uniqueHosts).changes;

    return { deleted, missing };
  }

  /** 호스트 삭제 — 삭제된 행 수 반환 */
  delete(host: string): number {
    return this.db.prepare(`DELETE FROM domains WHERE host = ?`).run(host).changes;
  }

  /**
   * 비동기 작업이 포함된 흐름을 SQLite 트랜잭션으로 감싸는 헬퍼 (#311)
   *
   * 무엇을: BEGIN IMMEDIATE 로 트랜잭션을 시작하고, 콜백의 결과(`commit: true|false`)에 따라
   *        COMMIT 또는 ROLLBACK 으로 종료한다. 콜백이 throw 하면 ROLLBACK 후 재throw.
   *
   * 왜: better-sqlite3 의 `db.transaction()` 래퍼는 동기 콜백만 지원하므로, Proxy gRPC/HTTP
   *    호출처럼 `await` 가 필요한 흐름에서는 사용할 수 없다. 도메인 DELETE 롤백 경로에서
   *    `delete()` → `await syncToProxy()` → 실패 시 복원 시퀀스가 트랜잭션 밖에서 실행되어
   *    (a) `created_at` DEFAULT 재설정, (b) `domain_stats` FK CASCADE 영구 손실 문제가 발생했다.
   *    `BEGIN IMMEDIATE` 로 즉시 RESERVED 락을 잡고, 실패 시 ROLLBACK 만 하면 CASCADE 도
   *    같이 되돌아가 원본 행이 그대로 살아난다.
   *
   * 사용 시 주의:
   *  - 콜백 안에서는 같은 `db` 커넥션으로만 쿼리해야 한다(다른 커넥션은 격리 수준 때문에 미커밋
   *    상태를 보지 못한다). admin-server 는 단일 better-sqlite3 인스턴스를 공유하므로 OK.
   *  - 호출자는 host 단위 락(`withHostLock`) 안에서 호출해 동일 host 의 다른 요청과 직렬화한다.
   */
  async runInTransactionAsync<T>(
    fn: () => Promise<{ commit: boolean; value: T }>,
  ): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    let result: { commit: boolean; value: T };
    try {
      result = await fn();
    } catch (err) {
      // 콜백 예외는 항상 ROLLBACK — 부분 변경이 남지 않도록 한다
      try { this.db.exec('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션은 무시 */ }
      throw err;
    }
    if (result.commit) {
      this.db.exec('COMMIT');
    } else {
      this.db.exec('ROLLBACK');
    }
    return result.value;
  }
}
