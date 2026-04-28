/// OptimizationEventsRepository 유닛 테스트
/// in-memory SQLite로 실제 SQL을 돌려 insert/query/stats/prune 동작을 검증한다.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  OptimizationEventsRepository,
  OPTIMIZATION_EVENTS_SCHEMA,
  type OptimizationEventInput,
} from './optimization-events-repo.js';

let db: Database.Database;
let repo: OptimizationEventsRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(OPTIMIZATION_EVENTS_SCHEMA);
  repo = new OptimizationEventsRepository(db);
});

/** 테스트용 기본 이벤트 팩토리 — over로 필요한 필드만 덮어쓴다 */
const sample = (over: Partial<OptimizationEventInput> = {}): OptimizationEventInput => ({
  event_type:   'media_cache',
  host:         'webdt.edunet.net',
  url:          'https://webdt.edunet.net/media/p34.mp4',
  decision:     'served_206',
  orig_size:    1024 * 1024,
  out_size:     1024,
  range_header: 'bytes=0-1023',
  content_type: 'video/mp4',
  elapsed_ms:   4,
  ...over,
});

describe('OptimizationEventsRepository', () => {
  // ─── insert ─────────────────────────────────────────────────────────────
  describe('insert', () => {
    it('단일 이벤트를 저장하고 query로 조회할 수 있다', () => {
      repo.insert(sample());
      const rows = repo.query();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('served_206');
      expect(rows[0].host).toBe('webdt.edunet.net');
    });

    it('ts 미지정 시 현재 시각(ISO8601)으로 채운다', () => {
      const before = new Date().toISOString();
      repo.insert(sample({ ts: undefined }));
      const after = new Date().toISOString();
      const ts = repo.query()[0].ts;
      expect(ts >= before && ts <= after).toBe(true);
    });

    it('url_hash는 SHA-256 앞 16자 hex로 저장된다', () => {
      repo.insert(sample({ url: 'https://a.test/x' }));
      expect(repo.query()[0].url_hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('같은 URL이면 같은 url_hash가 부여된다', () => {
      repo.insert(sample({ url: 'https://a.test/same', ts: '2026-04-19T10:00:00Z' }));
      repo.insert(sample({ url: 'https://a.test/same', ts: '2026-04-19T11:00:00Z' }));
      const hashes = repo.query().map((r) => r.url_hash);
      expect(hashes[0]).toBe(hashes[1]);
    });

    it('orig_size/out_size/range_header/content_type 미지정 시 null로 저장된다', () => {
      repo.insert(
        sample({
          orig_size:    undefined,
          out_size:     undefined,
          range_header: undefined,
          content_type: undefined,
        }),
      );
      const row = repo.query()[0];
      expect(row.orig_size).toBeNull();
      expect(row.out_size).toBeNull();
      expect(row.range_header).toBeNull();
      expect(row.content_type).toBeNull();
    });
  });

  // ─── insertBatch ────────────────────────────────────────────────────────
  describe('insertBatch', () => {
    it('여러 이벤트를 한 번에 저장하고 개수를 반환한다', () => {
      const n = repo.insertBatch([
        sample({ url: 'https://a.test/1' }),
        sample({ url: 'https://a.test/2' }),
        sample({ url: 'https://a.test/3' }),
      ]);
      expect(n).toBe(3);
      expect(repo.query()).toHaveLength(3);
    });

    it('빈 배열이면 0을 반환하고 아무것도 저장하지 않는다', () => {
      expect(repo.insertBatch([])).toBe(0);
      expect(repo.query()).toHaveLength(0);
    });
  });

  // ─── query ──────────────────────────────────────────────────────────────
  describe('query', () => {
    beforeEach(() => {
      repo.insertBatch([
        sample({ event_type: 'media_cache',    host: 'a.test', url: 'https://a.test/1.mp4', decision: 'served_206',    ts: '2026-04-19T10:00:00Z' }),
        sample({ event_type: 'media_cache',    host: 'a.test', url: 'https://a.test/2.mp4', decision: 'stored_new',    ts: '2026-04-19T11:00:00Z' }),
        sample({ event_type: 'image_optimize', host: 'b.test', url: 'https://b.test/x.png', decision: 'rejected_size', ts: '2026-04-19T12:00:00Z' }),
      ]);
    });

    it('필터 없이 조회하면 ts 내림차순으로 전체 반환', () => {
      const rows = repo.query();
      expect(rows.map((r) => r.url)).toEqual([
        'https://b.test/x.png',
        'https://a.test/2.mp4',
        'https://a.test/1.mp4',
      ]);
    });

    it('event_type 필터', () => {
      const rows = repo.query({ event_type: 'image_optimize' });
      expect(rows).toHaveLength(1);
      expect(rows[0].host).toBe('b.test');
    });

    it('host + decision 복합 필터', () => {
      const rows = repo.query({ host: 'a.test', decision: 'served_206' });
      expect(rows).toHaveLength(1);
      expect(rows[0].url).toBe('https://a.test/1.mp4');
    });

    it('since 이후(포함)만 반환', () => {
      const rows = repo.query({ since: '2026-04-19T11:30:00Z' });
      expect(rows).toHaveLength(1);
      expect(rows[0].host).toBe('b.test');
    });

    it('limit는 1~1000으로 클램프된다', () => {
      for (let i = 0; i < 50; i++) repo.insert(sample({ url: `https://c.test/${i}` }));
      expect(repo.query({ limit: 2000 })).toHaveLength(53); // 기존 3 + 50
      expect(repo.query({ limit: 5    })).toHaveLength(5);
      expect(repo.query({ limit: 0    })).toHaveLength(1);  // 0 → 1로 클램프
    });
  });

  // ─── statsByDecision ────────────────────────────────────────────────────
  describe('statsByDecision', () => {
    it('decision별 건수·바이트 합·평균 elapsed_ms 집계', () => {
      const now = new Date().toISOString();
      repo.insertBatch([
        sample({ decision: 'served_206',    orig_size: 1000, out_size: 100, elapsed_ms: 2, ts: now }),
        sample({ decision: 'served_206',    orig_size: 2000, out_size: 200, elapsed_ms: 4, ts: now }),
        sample({ decision: 'bypass_nocache',orig_size:  500, out_size: 500, elapsed_ms: 10, ts: now }),
      ]);
      const stats = repo.statsByDecision({ event_type: 'media_cache' });
      const s206 = stats.find((s) => s.decision === 'served_206')!;
      const bnc  = stats.find((s) => s.decision === 'bypass_nocache')!;
      expect(s206).toEqual({
        decision: 'served_206', count: 2, total_orig: 3000, total_out: 300, avg_elapsed_ms: 3,
      });
      expect(bnc.count).toBe(1);
    });

    it('period_sec 경계 이전 이벤트는 집계 제외', () => {
      const oldTs = new Date(Date.now() - 2 * 86400_000).toISOString(); // 2일 전
      const newTs = new Date().toISOString();
      repo.insertBatch([
        sample({ decision: 'served_206', ts: oldTs }),
        sample({ decision: 'served_206', ts: newTs }),
      ]);
      const stats = repo.statsByDecision({ period_sec: 86400 });
      expect(stats.find((s) => s.decision === 'served_206')?.count).toBe(1);
    });

    it('host 필터 동작', () => {
      const ts = new Date().toISOString();
      repo.insertBatch([
        sample({ host: 'a.test', decision: 'served_206', ts }),
        sample({ host: 'b.test', decision: 'served_206', ts }),
        sample({ host: 'a.test', decision: 'served_206', ts }),
      ]);
      const stats = repo.statsByDecision({ host: 'a.test' });
      expect(stats.find((s) => s.decision === 'served_206')?.count).toBe(2);
    });
  });

  // ─── urlBreakdown search LIKE 이스케이프 (#150) ─────────────────────────
  describe('urlBreakdown — search LIKE 이스케이프', () => {
    beforeEach(() => {
      // "%" 가 포함된 URL 1건, 일반 URL 1건 삽입
      repo.insertBatch([
        sample({ url: 'https://cdn.test/img/100%2Fthumb.jpg', ts: new Date().toISOString() }),
        sample({ url: 'https://cdn.test/img/other.jpg',       ts: new Date().toISOString() }),
      ]);
    });

    it('search에 % 포함 시 와일드카드가 아닌 리터럴로 매칭한다', () => {
      // search="%" 이면 URL에 리터럴 % 를 포함한 건만 반환해야 한다
      // beforeEach에서 삽입된 2건 중 "100%2Fthumb.jpg" 1건만 매칭되어야 한다
      // 버그 상태에서는 LIKE "%%" 로 해석돼 전체 2건이 반환됨
      const result = repo.urlBreakdown({ host: 'webdt.edunet.net', search: '%' });
      expect(result.total).toBe(1);
      expect(result.items[0].url).toBe('https://cdn.test/img/100%2Fthumb.jpg');
    });

    it('search에 % 를 포함한 URL은 정상 매칭한다 (host 일치 조건 포함)', () => {
      repo.insertBatch([
        sample({ host: 'cdn.test', url: 'https://cdn.test/img/100%2Fthumb.jpg', ts: new Date().toISOString() }),
        sample({ host: 'cdn.test', url: 'https://cdn.test/img/other.jpg',       ts: new Date().toISOString() }),
      ]);
      // search="%2F" → "%" 포함 URL만 반환
      const result = repo.urlBreakdown({ host: 'cdn.test', search: '%2F' });
      expect(result.total).toBe(1);
      expect(result.items[0].url).toBe('https://cdn.test/img/100%2Fthumb.jpg');
    });

    it('search에 % 만 포함 시 전체를 반환하지 않는다 (와일드카드 방지)', () => {
      repo.insertBatch([
        sample({ host: 'cdn.test', url: 'https://cdn.test/a.jpg', ts: new Date().toISOString() }),
        sample({ host: 'cdn.test', url: 'https://cdn.test/b.jpg', ts: new Date().toISOString() }),
      ]);
      // "%" 를 와일드카드로 해석하면 모든 URL이 매칭되어 total>0이 되는 버그
      // 이스케이프 후에는 URL에 "%" 없으면 0건
      const result = repo.urlBreakdown({ host: 'cdn.test', search: 'nopercent%' });
      expect(result.total).toBe(0);
    });
  });

  // ─── prune ──────────────────────────────────────────────────────────────
  describe('prune', () => {
    it('기준 시각 이전 이벤트를 삭제하고 삭제 개수를 반환', () => {
      repo.insertBatch([
        sample({ ts: '2026-04-10T00:00:00Z' }),
        sample({ ts: '2026-04-15T00:00:00Z' }),
        sample({ ts: '2026-04-18T00:00:00Z' }),
      ]);
      const removed = repo.prune('2026-04-16T00:00:00Z');
      expect(removed).toBe(2);
      expect(repo.query()).toHaveLength(1);
    });
  });
});
