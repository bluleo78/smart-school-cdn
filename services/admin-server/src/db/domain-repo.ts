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
    host        TEXT PRIMARY KEY,
    origin      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
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
}

/** findAll 검색/필터 옵션 */
export interface FindAllOptions {
  /** host 또는 origin 부분 일치 검색 */
  q?: string;
  /** 활성화 여부 필터 */
  enabled?: boolean;
  /** 정렬 기준 컬럼 (기본값: created_at DESC) */
  sort?: string;
}

/** sort 화이트리스트 — SQL injection 방지 */
const SORT_WHITELIST = new Set(['host', 'created_at', 'updated_at']);

/**
 * 도메인 매핑 리포지토리
 * 생성자로 DB 커넥션을 주입받아 테스트에서 쉽게 교체할 수 있도록 한다.
 */
export class DomainRepository {
  constructor(private readonly db: Database) {}

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

  /** 호스트로 단건 조회 — 없으면 undefined */
  findByHost(host: string): Domain | undefined {
    return this.db
      .prepare(
        `SELECT host, origin, enabled, description, created_at, updated_at
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
      conditions.push(`(host LIKE ? OR origin LIKE ?)`);
      const like = `%${options.q}%`;
      params.push(like, like);
    }

    if (options?.enabled !== undefined) {
      conditions.push(`enabled = ?`);
      params.push(options.enabled ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // sort 화이트리스트 검증 — 허용되지 않은 값은 기본값으로 대체
    const sortCol = options?.sort && SORT_WHITELIST.has(options.sort) ? options.sort : 'created_at';
    const orderBy = `ORDER BY ${sortCol} DESC`;

    return this.db
      .prepare(
        `SELECT host, origin, enabled, description, created_at, updated_at
         FROM domains ${where} ${orderBy}`,
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
    data: { origin?: string; enabled?: number; description?: string },
  ): Domain | undefined {
    const sets: string[] = [];
    const params: (string | number)[] = [];

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
   * 도메인 일괄 등록
   * - 트랜잭션 내에서 각각 INSERT ON CONFLICT upsert
   * - 개별 실패 시 에러 수집하고 나머지 계속 처리
   */
  bulkInsert(
    domains: Array<{ host: string; origin: string }>,
  ): { success: number; failed: Array<{ host: string; error: string }> } {
    const failed: Array<{ host: string; error: string }> = [];
    let success = 0;

    const stmt = this.db.prepare(
      `INSERT INTO domains (host, origin) VALUES (?, ?)
       ON CONFLICT(host) DO UPDATE SET
         origin = excluded.origin,
         updated_at = strftime('%s', 'now')`,
    );

    const runAll = this.db.transaction(() => {
      for (const { host, origin } of domains) {
        try {
          stmt.run(host, origin);
          success++;
        } catch (err) {
          failed.push({
            host,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    runAll();
    return { success, failed };
  }

  /**
   * 도메인 일괄 삭제
   * - IN 절로 여러 호스트를 한 번에 삭제
   * - 삭제된 행 수 반환
   */
  bulkDelete(hosts: string[]): number {
    if (hosts.length === 0) return 0;

    const placeholders = hosts.map(() => '?').join(', ');
    return this.db
      .prepare(`DELETE FROM domains WHERE host IN (${placeholders})`)
      .run(...hosts).changes;
  }

  /** 호스트 삭제 — 삭제된 행 수 반환 */
  delete(host: string): number {
    return this.db.prepare(`DELETE FROM domains WHERE host = ?`).run(host).changes;
  }
}
