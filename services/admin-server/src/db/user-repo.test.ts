import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { UserRepository, USER_SCHEMA } from './user-repo.js';

describe('UserRepository', () => {
  let db: Database.Database;
  let repo: UserRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(USER_SCHEMA);
    repo = new UserRepository(db);
  });

  it('count 초기값은 0', () => {
    expect(repo.count()).toBe(0);
  });

  it('create 후 findByUsername 로 조회된다', () => {
    const user = repo.create('admin@school.local', 'hash1');
    expect(user.id).toBeGreaterThan(0);
    expect(user.username).toBe('admin@school.local');
    expect(user.password_hash).toBe('hash1');
    const found = repo.findByUsername('admin@school.local');
    expect(found?.id).toBe(user.id);
  });

  it('findByUsername 존재하지 않으면 null', () => {
    expect(repo.findByUsername('x@y.z')).toBeNull();
  });

  it('중복 username 는 UNIQUE 제약으로 throw', () => {
    repo.create('a@b.c', 'h1');
    expect(() => repo.create('a@b.c', 'h2')).toThrow();
  });

  // 이슈 #340 회귀 방지 — username UNIQUE 가 COLLATE NOCASE 로 동작하여
  // 라우트 정규화 우회 시에도 대소문자 다른 username 이 공존하지 못한다.
  it('대소문자만 다른 username 도 UNIQUE 제약으로 throw (COLLATE NOCASE)', () => {
    repo.create('User@Example.Com', 'h1');
    expect(() => repo.create('user@example.com', 'h2')).toThrow();
    expect(() => repo.create('USER@EXAMPLE.COM', 'h3')).toThrow();
  });

  // 이슈 #340 — case-insensitive 인덱스로 조회 시에도 동일 행이 반환된다.
  it('대소문자 다른 키로 조회해도 같은 row 반환 (COLLATE NOCASE)', () => {
    const u = repo.create('Mixed@Case.Test', 'h');
    expect(repo.findByUsername('mixed@case.test')?.id).toBe(u.id);
    expect(repo.findByUsername('MIXED@CASE.TEST')?.id).toBe(u.id);
  });

  it('updatePassword 로 hash 가 갱신된다', () => {
    const u = repo.create('a@b.c', 'old');
    repo.updatePassword(u.id, 'new');
    expect(repo.findByUsername('a@b.c')?.password_hash).toBe('new');
  });

  it('disable 하면 disabled_at 이 채워진다', () => {
    const u = repo.create('a@b.c', 'h');
    repo.disable(u.id);
    expect(repo.findByUsername('a@b.c')?.disabled_at).not.toBeNull();
  });

  // 이슈 #106 회귀 방지 — enable() 메서드 없어서 재활성화 불가
  it('enable 하면 disabled_at 이 NULL 로 초기화된다', () => {
    const u = repo.create('a@b.c', 'h');
    repo.disable(u.id);
    expect(repo.findByUsername('a@b.c')?.disabled_at).not.toBeNull();
    repo.enable(u.id);
    expect(repo.findByUsername('a@b.c')?.disabled_at).toBeNull();
  });

  // 이슈 #106 — 이미 활성 상태에서 enable() 호출 시 오류 없이 통과 (멱등성)
  it('이미 활성 사용자에게 enable() 호출해도 오류 없이 활성 유지', () => {
    const u = repo.create('a@b.c', 'h');
    expect(() => repo.enable(u.id)).not.toThrow();
    expect(repo.findByUsername('a@b.c')?.disabled_at).toBeNull();
  });

  it('updateLastLogin 은 last_login_at 을 갱신한다', () => {
    const u = repo.create('a@b.c', 'h');
    repo.updateLastLogin(u.id);
    const found = repo.findByUsername('a@b.c');
    expect(found?.last_login_at).not.toBeNull();
  });

  // 이슈 #343 회귀 방지 — updateLastLogin 은 다른 update 들과 일관되게
  // updated_at 도 함께 갱신해야 한다 (disable/enable/updatePassword 와 동일 패턴).
  it('updateLastLogin 은 updated_at 도 함께 갱신한다 (#343)', async () => {
    const u = repo.create('a@b.c', 'h');
    const before = repo.findById(u.id)!;
    // ISO 문자열 비교를 확실히 하기 위해 짧게 대기 (now() 가 같은 ms 일 수 있음)
    await new Promise((r) => setTimeout(r, 5));
    repo.updateLastLogin(u.id);
    const after = repo.findById(u.id)!;
    expect(after.last_login_at).not.toBeNull();
    expect(after.updated_at).not.toBe(before.updated_at);
    expect(after.updated_at >= before.updated_at).toBe(true);
    // last_login_at 과 updated_at 이 동일 시점 (같은 now 사용)
    expect(after.updated_at).toBe(after.last_login_at);
  });

  it('list 기본 정렬은 created_at DESC — 최신 등록 사용자가 첫 번째 (#344)', async () => {
    // 도메인(#199)·이벤트와 일관된 정렬 정책. 같은 ms 시점에 만들어진 row 가 있어도
    // 보조 정렬 키(id ASC)로 안정 정렬 — 명시적 시간 차이를 두어 검증 견고화.
    repo.create('first@b.c', 'h');
    await new Promise((r) => setTimeout(r, 5));
    repo.create('second@b.c', 'h');
    await new Promise((r) => setTimeout(r, 5));
    repo.create('third@b.c', 'h');
    const all = repo.list();
    expect(all.map(u => u.username)).toEqual(['third@b.c', 'second@b.c', 'first@b.c']);
  });

  it('list — sort=id&order=asc 명시 시 id 오름차순으로 우선 적용 (#344)', () => {
    repo.create('c@b.c', 'h');
    repo.create('a@b.c', 'h');
    repo.create('b@b.c', 'h');
    const all = repo.list({ sort: 'id', order: 'asc' });
    expect(all.map(u => u.username)).toEqual(['c@b.c', 'a@b.c', 'b@b.c']);
  });

  it('list — sort=username&order=asc 알파벳 정렬 (#344)', () => {
    repo.create('c@b.c', 'h');
    repo.create('a@b.c', 'h');
    repo.create('b@b.c', 'h');
    const all = repo.list({ sort: 'username', order: 'asc' });
    expect(all.map(u => u.username)).toEqual(['a@b.c', 'b@b.c', 'c@b.c']);
  });

  it('list — 화이트리스트 외 sort 값은 기본값(created_at)으로 fallback (#344)', async () => {
    // SQL injection 방어 다중 레이어 — repo 단에서도 화이트리스트 미통과 시 안전 fallback.
    // sort 만 잘못된 값이고 order 는 명시 안 함 → sort=created_at, order=DESC(기본).
    repo.create('first@b.c', 'h');
    await new Promise((r) => setTimeout(r, 5));
    repo.create('second@b.c', 'h');
    const all = repo.list({ sort: '; DROP TABLE users; --' });
    // 기본값(created_at DESC)로 fallback. second 가 더 최근이므로 첫 번째.
    expect(all[0].username).toBe('second@b.c');
  });

  // 이슈 #376 회귀 방지 — 중복 마이그레이션(#190/#340)이 보존을 위해 남긴
  // `__dup_<id>__` prefix 행은 list()/findByUsername()/count() 모두에서 제외되어야 한다.
  describe('__dup_ prefix archive 행 가시성 차단 (#376)', () => {
    beforeEach(() => {
      // 마이그레이션이 prefix 를 직접 INSERT 한 상황을 모사 — repo.create 는 정규화된
      // username 만 받으므로 prefix 행은 raw SQL 로 주입한다.
      const now = new Date().toISOString();
      db.prepare('INSERT INTO users (username, password_hash, created_at, updated_at, disabled_at) VALUES (?, ?, ?, ?, ?)')
        .run('__dup_3__bluleo78@gmail.com', 'h', now, now, now);
      db.prepare('INSERT INTO users (username, password_hash, created_at, updated_at, disabled_at) VALUES (?, ?, ?, ?, ?)')
        .run('__dup_9__bluleo78@gmail.com', 'h', now, now, now);
      // 정상 사용자도 한 명 — 결과에는 이 한 명만 보여야 한다.
      repo.create('active@example.com', 'h');
    });

    it('list() 응답에 __dup_ 행이 포함되지 않는다', () => {
      const rows = repo.list();
      expect(rows.map(r => r.username)).toEqual(['active@example.com']);
      expect(rows.some(r => r.username.startsWith('__dup_'))).toBe(false);
    });

    it('findByUsername() 으로 __dup_ 행을 조회할 수 없다', () => {
      expect(repo.findByUsername('__dup_3__bluleo78@gmail.com')).toBeNull();
      expect(repo.findByUsername('__dup_9__bluleo78@gmail.com')).toBeNull();
      // 정상 사용자는 그대로 조회됨
      expect(repo.findByUsername('active@example.com')?.username).toBe('active@example.com');
    });

    it('count() 가 __dup_ 행을 제외한 활성 schema 사용자만 센다', () => {
      // 정상 1명만 카운트 — prefix 2명 제외
      expect(repo.count()).toBe(1);
    });
  });

  it('findById 가 일치하는 row 반환', () => {
    const u = repo.create('a@b.c', 'h');
    expect(repo.findById(u.id)?.username).toBe('a@b.c');
    expect(repo.findById(9999)).toBeNull();
  });

  // 이슈 #330/#331 — JWT 세션 무효화를 위한 token_version 컬럼.
  // 비활성화·비밀번호 변경 시 bump 하여 기존 stateless JWT 를 즉시 무효화한다.
  describe('token_version (#330/#331)', () => {
    it('신규 사용자의 token_version 기본값은 0', () => {
      const u = repo.create('a@b.c', 'h');
      expect(u.token_version).toBe(0);
      expect(repo.findById(u.id)?.token_version).toBe(0);
    });

    it('bumpTokenVersion 호출 시 1씩 증가하고 updated_at 도 갱신', async () => {
      const u = repo.create('a@b.c', 'h');
      const before = repo.findById(u.id)!;
      await new Promise((r) => setTimeout(r, 5));
      repo.bumpTokenVersion(u.id);
      const after = repo.findById(u.id)!;
      expect(after.token_version).toBe(1);
      expect(after.updated_at).not.toBe(before.updated_at);
      repo.bumpTokenVersion(u.id);
      expect(repo.findById(u.id)!.token_version).toBe(2);
    });
  });
});
