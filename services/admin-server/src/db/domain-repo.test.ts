import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainRepository } from './domain-repo.js';
import { createTestDb } from './test-helper.js';

describe('DomainRepository', () => {
  let db: Database;
  let repo: DomainRepository;

  // 매 테스트마다 새 인메모리 DB를 주입해 완벽한 격리 보장
  beforeEach(() => {
    db = createTestDb();
    repo = new DomainRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsert 후 findByHost로 조회할 수 있다', () => {
    repo.upsert('httpbin.org', 'https://httpbin.org');

    const found = repo.findByHost('httpbin.org');
    expect(found?.origin).toBe('https://httpbin.org');
    expect(found?.created_at).toBeTypeOf('number');
  });

  it('같은 host로 upsert하면 origin이 갱신된다', () => {
    repo.upsert('example.com', 'https://old.example.com');
    repo.upsert('example.com', 'https://new.example.com');

    expect(repo.findByHost('example.com')?.origin).toBe('https://new.example.com');
    expect(repo.findAll()).toHaveLength(1);
  });

  it('미등록 호스트 조회는 undefined를 반환한다', () => {
    expect(repo.findByHost('nope.invalid')).toBeUndefined();
  });

  it('delete는 삭제된 행 수를 반환하고 실제로 삭제된다', () => {
    repo.upsert('a.test', 'https://a.test');
    expect(repo.delete('a.test')).toBe(1);
    expect(repo.delete('a.test')).toBe(0);
    expect(repo.findByHost('a.test')).toBeUndefined();
  });

  it('테스트 간 격리 — 이전 테스트의 데이터가 남아있지 않다', () => {
    // 앞선 테스트들에서 upsert를 많이 했지만, beforeEach의 createTestDb()로
    // DB 자체가 새로 만들어졌기 때문에 이 테스트에서 전체 조회는 비어있어야 한다
    expect(repo.findAll()).toEqual([]);
  });
});
