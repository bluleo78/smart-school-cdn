import type Database from 'better-sqlite3';

export const USER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL,
    disabled_at    TEXT,
    last_login_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
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

  updateLastLogin(id: number): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, id);
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
