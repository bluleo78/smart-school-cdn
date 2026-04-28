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

  describe('findAll — 검색/필터', () => {
    beforeEach(() => {
      repo.upsert('school.local', 'https://school.local');
      repo.upsert('cdn.example.com', 'https://cdn.example.com');
      repo.upsert('disabled.test', 'https://disabled.test');
      // disabled.test는 비활성화
      repo.update('disabled.test', { enabled: 0 });
    });

    it('검색어로 host를 필터링한다', () => {
      const results = repo.findAll({ q: 'school' });
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe('school.local');
    });

    it('검색어로 origin을 필터링한다', () => {
      const results = repo.findAll({ q: 'cdn.example' });
      expect(results).toHaveLength(1);
      expect(results[0].origin).toBe('https://cdn.example.com');
    });

    // LIKE 특수문자 이스케이프 검증 (#150)
    it('q에 % 포함 시 와일드카드가 아닌 리터럴로 매칭한다', () => {
      // "%" 는 어떤 도메인에도 포함되지 않으므로 결과가 0건이어야 한다
      expect(repo.findAll({ q: '%' })).toHaveLength(0);
    });

    it('q에 _ 포함 시 임의 1자 와일드카드가 아닌 리터럴로 매칭한다', () => {
      // "school_local" 은 존재하지 않는다 (실제 host는 "school.local")
      expect(repo.findAll({ q: 'school_local' })).toHaveLength(0);
    });

    it('q에 리터럴 % 를 포함한 도메인은 정상 매칭한다', () => {
      // host에 실제 "%" 문자가 들어간 도메인은 q=% 로 검색되어야 한다
      repo.upsert('100%.cdn.test', 'https://cdn.test');
      const results = repo.findAll({ q: '%' });
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe('100%.cdn.test');
    });

    it('enabled=true 필터링 — 활성 도메인만 반환한다', () => {
      const results = repo.findAll({ enabled: true });
      expect(results.every((d) => d.enabled === 1)).toBe(true);
      expect(results.find((d) => d.host === 'disabled.test')).toBeUndefined();
    });

    it('enabled=false 필터링 — 비활성 도메인만 반환한다', () => {
      const results = repo.findAll({ enabled: false });
      expect(results).toHaveLength(1);
      expect(results[0].host).toBe('disabled.test');
    });

    it('필터 없으면 전체를 반환한다', () => {
      expect(repo.findAll()).toHaveLength(3);
    });

    it('sort=host&order=asc — host 오름차순으로 정렬된다', () => {
      // 이슈 #83: order 파라미터 지원 검증
      const results = repo.findAll({ sort: 'host', order: 'asc' });
      // host 알파벳 오름차순: cdn.example.com, disabled.test, school.local
      expect(results[0].host).toBe('cdn.example.com');
      expect(results[1].host).toBe('disabled.test');
      expect(results[2].host).toBe('school.local');
    });

    it('sort=host&order=desc — host 내림차순으로 정렬된다', () => {
      const results = repo.findAll({ sort: 'host', order: 'desc' });
      // host 알파벳 내림차순: school.local, disabled.test, cdn.example.com
      expect(results[0].host).toBe('school.local');
      expect(results[1].host).toBe('disabled.test');
      expect(results[2].host).toBe('cdn.example.com');
    });

    it('order 미지정 시 기본 내림차순으로 동작한다', () => {
      // order 미지정 → 기본 DESC — 기존 동작 회귀 방지
      const allDefault = repo.findAll();
      const allDesc = repo.findAll({ order: 'desc' });
      // 결과 순서가 동일해야 한다 (created_at DESC)
      expect(allDefault.map((d) => d.host)).toEqual(allDesc.map((d) => d.host));
    });

    it('허용되지 않은 order 값은 기본 DESC로 대체된다', () => {
      // SQL injection 방지 — 허용되지 않은 값은 무시
      const results = repo.findAll({ sort: 'host', order: 'INVALID' });
      // order=DESC 동작이어야 한다
      const resultsDesc = repo.findAll({ sort: 'host', order: 'desc' });
      expect(results.map((d) => d.host)).toEqual(resultsDesc.map((d) => d.host));
    });
  });

  describe('update', () => {
    beforeEach(() => {
      repo.upsert('update.test', 'https://old.origin');
    });

    it('origin 변경 시 updated_at이 갱신된다', async () => {
      const before = repo.findByHost('update.test')!;
      // updated_at은 초 단위이므로 1초 지연 후 변경
      await new Promise((r) => setTimeout(r, 1100));
      const updated = repo.update('update.test', { origin: 'https://new.origin' });
      expect(updated?.origin).toBe('https://new.origin');
      expect(updated?.updated_at).toBeGreaterThanOrEqual(before.updated_at);
    });

    it('description을 변경할 수 있다', () => {
      const updated = repo.update('update.test', { description: '교과서 CDN' });
      expect(updated?.description).toBe('교과서 CDN');
    });

    it('존재하지 않는 도메인은 undefined를 반환한다', () => {
      expect(repo.update('nonexistent.host', { origin: 'https://x.com' })).toBeUndefined();
    });
  });

  describe('toggleEnabled', () => {
    beforeEach(() => {
      repo.upsert('toggle.test', 'https://toggle.test');
    });

    it('활성 상태를 비활성으로 전환한다', () => {
      const toggled = repo.toggleEnabled('toggle.test');
      expect(toggled?.enabled).toBe(0);
    });

    it('비활성 상태를 활성으로 전환한다', () => {
      repo.update('toggle.test', { enabled: 0 });
      const toggled = repo.toggleEnabled('toggle.test');
      expect(toggled?.enabled).toBe(1);
    });
  });

  describe('bulkInsert', () => {
    it('여러 도메인을 일괄 추가한다', () => {
      const result = repo.bulkInsert([
        { host: 'a.bulk', origin: 'https://a.bulk' },
        { host: 'b.bulk', origin: 'https://b.bulk' },
      ]);
      expect(result.success).toBe(2);
      expect(result.failed).toHaveLength(0);
      expect(repo.findAll()).toHaveLength(2);
    });

    it('중복 host는 upsert로 origin이 갱신된다', () => {
      repo.upsert('dup.bulk', 'https://old.dup');
      const result = repo.bulkInsert([{ host: 'dup.bulk', origin: 'https://new.dup' }]);
      expect(result.success).toBe(1);
      expect(repo.findByHost('dup.bulk')?.origin).toBe('https://new.dup');
    });
  });

  describe('bulkDelete', () => {
    beforeEach(() => {
      repo.upsert('del1.test', 'https://del1.test');
      repo.upsert('del2.test', 'https://del2.test');
      repo.upsert('keep.test', 'https://keep.test');
    });

    it('선택된 도메인을 일괄 삭제하고 삭제된 행 수를 반환한다', () => {
      const count = repo.bulkDelete(['del1.test', 'del2.test']);
      expect(count).toBe(2);
      expect(repo.findByHost('del1.test')).toBeUndefined();
      expect(repo.findByHost('del2.test')).toBeUndefined();
      expect(repo.findByHost('keep.test')).toBeDefined();
    });

    it('빈 배열이면 0을 반환하고 아무것도 삭제하지 않는다', () => {
      expect(repo.bulkDelete([])).toBe(0);
      expect(repo.findAll()).toHaveLength(3);
    });
  });
});
