import type { Database } from 'better-sqlite3';

/**
 * 프록시 대상 도메인 테이블 스키마
 * - host: 클라이언트 요청의 Host 헤더 값 (PK)
 * - origin: 실제로 중계할 원본 서버 URL
 * - created_at: 등록 시각
 */
export const DOMAIN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS domains (
    host       TEXT PRIMARY KEY,
    origin     TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;

/** 도메인 한 건을 표현하는 타입 */
export interface Domain {
  host: string;
  origin: string;
  created_at: number;
}

/**
 * 도메인 매핑 리포지토리
 * 생성자로 DB 커넥션을 주입받아 테스트에서 쉽게 교체할 수 있도록 한다.
 */
export class DomainRepository {
  constructor(private readonly db: Database) {}

  /** 도메인 등록 (이미 있으면 origin 갱신) */
  upsert(host: string, origin: string): void {
    this.db
      .prepare(
        `INSERT INTO domains (host, origin) VALUES (?, ?)
         ON CONFLICT(host) DO UPDATE SET origin = excluded.origin`,
      )
      .run(host, origin);
  }

  /** 호스트로 단건 조회 — 없으면 undefined */
  findByHost(host: string): Domain | undefined {
    return this.db
      .prepare(`SELECT host, origin, created_at FROM domains WHERE host = ?`)
      .get(host) as Domain | undefined;
  }

  /** 전체 목록 — 최신 등록순 */
  findAll(): Domain[] {
    return this.db
      .prepare(`SELECT host, origin, created_at FROM domains ORDER BY created_at DESC`)
      .all() as Domain[];
  }

  /** 호스트 삭제 — 삭제된 행 수 반환 */
  delete(host: string): number {
    return this.db.prepare(`DELETE FROM domains WHERE host = ?`).run(host).changes;
  }
}
