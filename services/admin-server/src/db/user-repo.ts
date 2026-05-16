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

/** list() 정렬 옵션 — 라우트에서 화이트리스트 검증 후 전달 (#344) */
export interface UserListOptions {
  /** 정렬 컬럼 (기본 created_at) */
  sort?: string;
  /** 정렬 방향 — 'asc' | 'desc' (기본 desc) */
  order?: string;
}

/**
 * sort 화이트리스트 — SQL injection 방지를 위해 식별자를 직접 string interpolation
 * 하기 전 반드시 검증한다. 도메인 라우트(#295)와 동일 패턴.
 */
const USER_SORT_WHITELIST = new Set(['id', 'username', 'created_at', 'updated_at', 'last_login_at']);
const USER_ORDER_WHITELIST = new Set(['asc', 'desc']);

/**
 * 사용자 계정 저장소 — argon2id 해시는 password_hash 컬럼에 전체 encoded string 으로 보관.
 * username 은 email 형식으로 사용하지만 컬럼명은 username 을 유지.
 */
export class UserRepository {
  constructor(private db: Database.Database) {}

  /**
   * 사용자 수 — 이슈 #376. `__dup_` prefix 행(중복 마이그레이션 보존 archive)은 제외.
   * list() 결과 길이와 일관성을 유지하여 admin UI 카운트 표기가 정확해진다.
   */
  count(): number {
    return (this.db
      .prepare("SELECT COUNT(*) as c FROM users WHERE username NOT LIKE '\\_\\_dup\\_%' ESCAPE '\\'")
      .get() as { c: number }).c;
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

  /**
   * username 으로 단건 조회 — 이슈 #376.
   * `__dup_` prefix 행은 case-insensitive 중복 마이그레이션(#190/#340)이 보존을 위해
   * 남긴 archive 성격의 행이므로 로그인/생성 조회 경로에서도 보이지 않아야 한다.
   * 만약 정상 사용자가 우연히 `__dup_` 로 시작하는 username 을 입력해도 그 행은
   * 무시되어 신규 가입이 막히지 않고, 이미 정리된 계정으로의 로그인 시도도 차단된다.
   * LIKE 의 `_` 와이드카드를 문자 그대로 매칭하기 위해 ESCAPE 절을 사용한다.
   */
  findByUsername(username: string): UserRow | null {
    return (this.db
      .prepare("SELECT * FROM users WHERE username = ? AND username NOT LIKE '\\_\\_dup\\_%' ESCAPE '\\'")
      .get(username) as UserRow | undefined) ?? null;
  }

  /**
   * 사용자 목록 조회 — 정렬은 도메인(#199)·이벤트와 일관된 정책으로 통일한다 (#344).
   * 기본 정렬: created_at DESC (최신 등록 사용자가 첫 페이지 상단에 노출되도록).
   * sort/order 옵션이 명시되면 화이트리스트 검증 후 그것을 우선 적용.
   * last_login_at 으로 정렬할 때 NULL 은 ASC 에서는 위, DESC 에서는 아래에 위치 —
   * 비로그인 사용자가 "최근 로그인 순" 상단에 떠서 의미를 해치는 것을 방지하기 위해
   * NULLS LAST(DESC) / NULLS FIRST(ASC) 처럼 DESC 시 NULL 을 뒤로 보낸다.
   * 동순위 안정성 보장을 위해 보조 정렬 키로 id ASC 를 항상 추가한다.
   */
  list(options?: UserListOptions): UserRow[] {
    const sortCol = options?.sort && USER_SORT_WHITELIST.has(options.sort) ? options.sort : 'created_at';
    const sortDir = options?.order && USER_ORDER_WHITELIST.has(options.order.toLowerCase())
      ? options.order.toUpperCase()
      : 'DESC';
    // last_login_at 은 NULL 가능 컬럼이므로 DESC 정렬 시 NULL 을 마지막으로 밀어내
    // "최근 로그인 순" 상단에 미로그인 사용자가 끼는 부자연스러움을 방지.
    const nullsClause = sortCol === 'last_login_at'
      ? (sortDir === 'DESC' ? `${sortCol} IS NULL, ` : '')
      : '';
    const orderBy = `ORDER BY ${nullsClause}${sortCol} ${sortDir}, id ASC`;
    // 이슈 #376 — 중복 마이그레이션(#190/#340)이 보존을 위해 남긴 `__dup_<id>__` prefix 행은
    // archive 성격이므로 사용자 목록 응답에서 제외한다. 운영 데이터 무결성/UX 혼동 방지.
    // LIKE 의 `_` 와이드카드를 리터럴로 매칭하기 위해 ESCAPE 절 사용.
    return this.db
      .prepare(`SELECT * FROM users WHERE username NOT LIKE '\\_\\_dup\\_%' ESCAPE '\\' ${orderBy}`)
      .all() as UserRow[];
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
