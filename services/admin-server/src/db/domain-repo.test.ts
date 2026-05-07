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
    it('여러 도메인을 일괄 추가하면 added 가 2 이고 skipped/failed 는 비어있다', () => {
      const result = repo.bulkInsert([
        { host: 'a.bulk', origin: 'https://a.bulk' },
        { host: 'b.bulk', origin: 'https://b.bulk' },
      ]);
      expect(result.added).toBe(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(repo.findAll()).toHaveLength(2);
    });

    // (#197) 기존 host 는 origin 을 보존하고 skipped 로 분류해야 한다.
    // 과거 upsert 시맨틱은 사용자 안내 없이 origin 을 덮어써 트래픽이 잘못 라우팅되는 위험이 있었다.
    it('중복 host 는 origin 을 보존하고 skipped 로 분류한다 (#197)', () => {
      repo.upsert('dup.bulk', 'https://old.dup');
      const result = repo.bulkInsert([{ host: 'dup.bulk', origin: 'https://new.dup' }]);
      expect(result.added).toBe(0);
      expect(result.skipped).toEqual([
        { host: 'dup.bulk', existingOrigin: 'https://old.dup' },
      ]);
      // origin 은 변경되지 않아야 한다 — 안전 우선 정책
      expect(repo.findByHost('dup.bulk')?.origin).toBe('https://old.dup');
    });

    // (#197) 신규 + 기존 혼합 입력 시 added 와 skipped 가 정확히 분리되어야 한다.
    it('신규/기존 혼합 입력에서 added 와 skipped 를 분리해서 보고한다 (#197)', () => {
      repo.upsert('exists.bulk', 'https://exists.original');
      const result = repo.bulkInsert([
        { host: 'exists.bulk', origin: 'https://exists.changed' },
        { host: 'fresh.bulk', origin: 'https://fresh.bulk' },
      ]);
      expect(result.added).toBe(1);
      expect(result.skipped).toEqual([
        { host: 'exists.bulk', existingOrigin: 'https://exists.original' },
      ]);
      expect(result.failed).toHaveLength(0);
      // 기존 host origin 은 보존, 신규 host 는 입력된 origin 으로 추가
      expect(repo.findByHost('exists.bulk')?.origin).toBe('https://exists.original');
      expect(repo.findByHost('fresh.bulk')?.origin).toBe('https://fresh.bulk');
    });
  });

  describe('bulkDelete', () => {
    beforeEach(() => {
      repo.upsert('del1.test', 'https://del1.test');
      repo.upsert('del2.test', 'https://del2.test');
      repo.upsert('keep.test', 'https://keep.test');
    });

    it('선택된 도메인을 일괄 삭제하고 deleted/missing을 반환한다', () => {
      const result = repo.bulkDelete(['del1.test', 'del2.test']);
      expect(result.deleted).toBe(2);
      expect(result.missing).toEqual([]);
      expect(repo.findByHost('del1.test')).toBeUndefined();
      expect(repo.findByHost('del2.test')).toBeUndefined();
      expect(repo.findByHost('keep.test')).toBeDefined();
    });

    it('빈 배열이면 deleted=0, missing=[]을 반환하고 아무것도 삭제하지 않는다', () => {
      expect(repo.bulkDelete([])).toEqual({ deleted: 0, missing: [] });
      expect(repo.findAll()).toHaveLength(3);
    });

    // (#212) 부분 실패: 요청한 host 중 일부가 DB에 없으면 missing 목록으로 반환되어야 한다.
    it('요청 호스트 중 일부가 DB에 없으면 missing 에 포함된다 (#212)', () => {
      const result = repo.bulkDelete(['del1.test', 'nope-aaa.test', 'nope-bbb.test']);
      expect(result.deleted).toBe(1);
      expect(result.missing.sort()).toEqual(['nope-aaa.test', 'nope-bbb.test']);
      expect(repo.findByHost('del1.test')).toBeUndefined();
    });

    // 요청에 동일 호스트가 중복 들어와도 중복 제거 후 한 번만 비교한다.
    it('중복 host는 중복 제거 후 비교한다 (#212)', () => {
      const result = repo.bulkDelete(['del1.test', 'del1.test', 'nope.test']);
      expect(result.deleted).toBe(1);
      expect(result.missing).toEqual(['nope.test']);
    });
  });

  /**
   * findAll limit/offset 페이지네이션 (#199)
   * - 미지정 시 기존 동작(전체 반환) 유지로 admin-web 호환
   * - 양의 정수만 적용, 음수/NaN/0은 silent 무시 (#199에서 silent ignore 자체가 문제이지만,
   *   라우트 레벨에서 검증을 통과해 repo로 들어온 값은 신뢰 가능한 값으로 가정)
   */
  describe('findAll — limit/offset 페이지네이션 (#199)', () => {
    beforeEach(() => {
      // 8건 등록 — created_at DESC 정렬이 기본이므로 가장 늦게 upsert된 host8이 첫 번째에 위치한다.
      // SQLite의 strftime('%s','now') 해상도가 초 단위라 동일 초 등록 시 정렬 순서가 모호해질 수 있어
      // 명시적으로 created_at을 직접 갱신하여 결정적인 순서를 만든다.
      for (let i = 1; i <= 8; i++) {
        repo.upsert(`host${i}.test`, `https://host${i}.test`);
        db.prepare('UPDATE domains SET created_at = ? WHERE host = ?').run(1_700_000_000 + i, `host${i}.test`);
      }
    });

    it('limit/offset 미지정 시 전체 8건을 반환한다 (기존 동작 유지)', () => {
      expect(repo.findAll()).toHaveLength(8);
    });

    it('limit=2 → 상위 2건만 반환', () => {
      const rows = repo.findAll({ limit: 2 });
      expect(rows).toHaveLength(2);
      // created_at DESC 기본 정렬 → host8, host7 순
      expect(rows[0].host).toBe('host8.test');
      expect(rows[1].host).toBe('host7.test');
    });

    it('limit=2&offset=1 → 두 번째부터 2건', () => {
      const rows = repo.findAll({ limit: 2, offset: 1 });
      expect(rows).toHaveLength(2);
      expect(rows[0].host).toBe('host7.test');
      expect(rows[1].host).toBe('host6.test');
    });

    it('offset=10000 → 빈 배열', () => {
      expect(repo.findAll({ limit: 2, offset: 10000 })).toEqual([]);
    });

    it('offset만 지정해도 동작한다 (LIMIT -1 보정)', () => {
      const rows = repo.findAll({ offset: 6 });
      expect(rows).toHaveLength(2);
      expect(rows[0].host).toBe('host2.test');
      expect(rows[1].host).toBe('host1.test');
    });

    it('q 필터와 함께 limit/offset 적용', () => {
      // host1~host8 모두 매칭, limit=3 → 상위 3건
      const rows = repo.findAll({ q: 'host', limit: 3 });
      expect(rows).toHaveLength(3);
    });
  });
});
