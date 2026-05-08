import type Database from 'better-sqlite3';

// 이슈 #340 — username 컬럼에 COLLATE NOCASE 부여하여 대소문자 무시 UNIQUE 보장.
// 라우트 레이어가 trim().toLowerCase() 정규화를 수행하더라도, 라우트를 우회하는
// 직접 INSERT(테스트 헬퍼·향후 internal API·sqlite3 CLI 등)에서도 동일 invariant 가
// DB 레벨에서 강제되도록 한다. 인덱스도 NOCASE 로 두어 case-insensitive 조회 시
// 인덱스 활용 가능.
export const USER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL,
    disabled_at    TEXT,
    last_login_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
`;

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  last_login_at: string | null;
}

/**
 * 사용자 계정 저장소 — argon2id 해시는 password_hash 컬럼에 전체 encoded string 으로 보관.
 * username 은 email 형식으로 사용하지만 컬럼명은 username 을 유지.
 */
export class UserRepository {
  constructor(private db: Database.Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  }

  create(username: string, passwordHash: string): UserRow {
    const now = new Date().toISOString();
    const info = this.db.prepare(
      'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(username, passwordHash, now, now);
    return this.findById(Number(info.lastInsertRowid))!;
  }

  findById(id: number): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  findByUsername(username: string): UserRow | null {
    return (this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined) ?? null;
  }

  list(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY id ASC').all() as UserRow[];
  }

  updatePassword(id: number, passwordHash: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, id);
  }

  // 이슈 #343 — last_login_at 갱신은 행을 변경하는 mutation 이므로 다른 update 들과
  // 동일하게 updated_at 도 함께 갱신하여 "행이 마지막으로 수정된 시점" 의미를 일관되게 유지.
  // disable/enable/updatePassword 와 동일 패턴.
  updateLastLogin(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  disable(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  /** 비활성화된 사용자를 재활성화한다 — disabled_at 을 NULL 로 초기화 */
  enable(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?').run(now, id);
  }
}
