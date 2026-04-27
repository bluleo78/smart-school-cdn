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

  it('list 는 password_hash 를 포함하되 순서는 id 오름차순', () => {
    repo.create('c@b.c', 'h');
    repo.create('a@b.c', 'h');
    repo.create('b@b.c', 'h');
    const all = repo.list();
    expect(all.map(u => u.username)).toEqual(['c@b.c', 'a@b.c', 'b@b.c']);
  });

  it('findById 가 일치하는 row 반환', () => {
    const u = repo.create('a@b.c', 'h');
    expect(repo.findById(u.id)?.username).toBe('a@b.c');
    expect(repo.findById(9999)).toBeNull();
  });
});
