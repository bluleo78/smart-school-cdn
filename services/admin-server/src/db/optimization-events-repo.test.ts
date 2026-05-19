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

    // 이슈 #377 — DB 컬럼은 INTEGER unix-sec. proxy 가 ISO 8601 로 push 해도 정수로 저장된다.
    it('insert 시 ts (ISO) 가 DB 에는 INTEGER unix-sec 로 저장된다 (#377)', () => {
      repo.insert(sample({ ts: '2026-04-19T10:00:00Z' }));
      const row = db.prepare('SELECT typeof(ts) as t, ts FROM optimization_events').get() as { t: string; ts: number };
      expect(row.t).toBe('integer');
      expect(row.ts).toBe(Math.floor(Date.parse('2026-04-19T10:00:00Z') / 1000));
    });

    it('ts 미지정 시 현재 시각(ISO8601)으로 채운다', () => {
      // #377 이후 DB 컬럼은 INTEGER unix-sec, repo 응답은 여전히 ISO 8601 문자열로 변환되어 반환된다.
      // ms 정밀도는 저장 단계에서 잘리므로 second 단위 윈도우(전/후 1초 여유)로 비교한다.
      const beforeSec = Math.floor(Date.now() / 1000);
      repo.insert(sample({ ts: undefined }));
      const afterSec = Math.floor(Date.now() / 1000);
      const tsMs = Date.parse(repo.query()[0].ts);
      expect(Number.isFinite(tsMs)).toBe(true);
      const tsSec = Math.floor(tsMs / 1000);
      expect(tsSec).toBeGreaterThanOrEqual(beforeSec);
      expect(tsSec).toBeLessThanOrEqual(afterSec);
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

    // #293 회귀 — 비정수 limit이 SQL `LIMIT`에 그대로 들어가 SQLITE_MISMATCH 발생하던 케이스.
    // clampInt가 floor + 클램프를 강제해 더 이상 throw 하지 않아야 한다.
    it('비정수 limit(예: 1.7)이 들어와도 SQLITE_MISMATCH 없이 정상 응답한다 (#293)', () => {
      for (let i = 0; i < 5; i++) repo.insert(sample({ url: `https://d.test/${i}` }));
      // 1.7 → floor → 1
      expect(() => repo.query({ limit: 1.7 as number })).not.toThrow();
      expect(repo.query({ limit: 1.7 as number })).toHaveLength(1);
      // 2.5 → floor → 2
      expect(repo.query({ limit: 2.5 as number })).toHaveLength(2);
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

  // ─── urlBreakdown limit/offset 정수화 (#294) ─────────────────────────────
  // 라우트가 Number.isFinite만으로 필터링하면 소수가 그대로 repo→SQL `LIMIT`로
  // 흘러가 SQLITE_MISMATCH 500을 일으킨다. clampInt/clampOffset이 floor + 클램프
  // 하므로 비정수 입력에도 정상 응답해야 한다.
  describe('urlBreakdown — 비정수 limit/offset (#294)', () => {
    it('소수 limit/offset(2.5, 1.7)이 들어와도 SQLITE_MISMATCH 없이 정상 응답한다', () => {
      const ts = new Date().toISOString();
      repo.insertBatch([
        sample({ host: 'cdn.test', url: 'https://cdn.test/a.jpg', ts }),
        sample({ host: 'cdn.test', url: 'https://cdn.test/b.jpg', ts }),
        sample({ host: 'cdn.test', url: 'https://cdn.test/c.jpg', ts }),
        sample({ host: 'cdn.test', url: 'https://cdn.test/d.jpg', ts }),
      ]);
      // limit=2.5 → floor → 2 / offset=1.7 → floor → 1
      expect(() =>
        repo.urlBreakdown({ host: 'cdn.test', limit: 2.5 as number, offset: 1.7 as number }),
      ).not.toThrow();
      const result = repo.urlBreakdown({
        host: 'cdn.test',
        limit:  2.5 as number,
        offset: 1.7 as number,
      });
      expect(result.items).toHaveLength(2);
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

  // ─── deleteByHost / deleteByHosts (#185) ────────────────────────────────
  describe('deleteByHost', () => {
    it('지정 호스트의 이벤트만 삭제하고 삭제 개수를 반환한다', () => {
      repo.insertBatch([
        sample({ host: 'a.test' }),
        sample({ host: 'a.test' }),
        sample({ host: 'b.test' }),
      ]);
      const removed = repo.deleteByHost('a.test');
      expect(removed).toBe(2);
      expect(repo.query()).toHaveLength(1);
      expect(repo.query()[0].host).toBe('b.test');
    });

    it('일치하는 호스트가 없으면 0을 반환한다', () => {
      repo.insertBatch([sample({ host: 'a.test' })]);
      expect(repo.deleteByHost('zzz.test')).toBe(0);
      expect(repo.query()).toHaveLength(1);
    });
  });

  // ─── reconcileOrphans (#379) ────────────────────────────────────────────
  describe('reconcileOrphans', () => {
    /**
     * domains 테이블이 같은 DB 에 존재해야 reconcile SQL 의 서브쿼리가 동작한다.
     * 라우트 핸들러에서 사용하는 실제 schema 와 동일하게 host PK + 필수 컬럼만 둔다.
     */
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS domains (
          host       TEXT PRIMARY KEY,
          origin     TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          enabled    INTEGER NOT NULL DEFAULT 1
        );
      `);
    });

    it('domains 에 없는 host 의 이벤트만 삭제하고 등록된 host 는 유지한다', () => {
      db.prepare(`INSERT INTO domains (host, origin) VALUES (?, ?)`).run('live.test', 'https://o');
      repo.insertBatch([
        sample({ host: 'live.test' }),
        sample({ host: 'live.test' }),
        sample({ host: 'gone.test' }),
        sample({ host: 'gone.test' }),
        sample({ host: 'gone.test' }),
      ]);

      const removed = repo.reconcileOrphans();

      expect(removed).toBe(3);
      const remaining = repo.query();
      expect(remaining).toHaveLength(2);
      expect(remaining.every((r) => r.host === 'live.test')).toBe(true);
    });

    it('domains 가 비었으면 모든 이벤트를 삭제한다', () => {
      repo.insertBatch([sample({ host: 'a.test' }), sample({ host: 'b.test' })]);
      expect(repo.reconcileOrphans()).toBe(2);
      expect(repo.query()).toHaveLength(0);
    });

    it('orphan 이 없으면 0 을 반환한다', () => {
      db.prepare(`INSERT INTO domains (host, origin) VALUES (?, ?)`).run('a.test', 'https://o');
      repo.insertBatch([sample({ host: 'a.test' })]);
      expect(repo.reconcileOrphans()).toBe(0);
      expect(repo.query()).toHaveLength(1);
    });
  });

  describe('deleteByHosts', () => {
    it('여러 호스트 이벤트를 일괄 삭제하고 삭제 개수를 반환한다', () => {
      repo.insertBatch([
        sample({ host: 'a.test' }),
        sample({ host: 'b.test' }),
        sample({ host: 'b.test' }),
        sample({ host: 'c.test' }),
      ]);
      const removed = repo.deleteByHosts(['a.test', 'b.test']);
      expect(removed).toBe(3);
      expect(repo.query()).toHaveLength(1);
      expect(repo.query()[0].host).toBe('c.test');
    });

    it('빈 배열이면 SQL 실행 없이 0을 반환한다', () => {
      repo.insertBatch([sample({ host: 'a.test' })]);
      expect(repo.deleteByHosts([])).toBe(0);
      expect(repo.query()).toHaveLength(1);
    });
  });

  describe('diagnoseAggregate (#387)', () => {
    it('hit_ratio, origin RTT, range 분포를 집계한다', () => {
      const url = 'https://x.test/v.mp4';
      const events: OptimizationEventInput[] = [];
      for (let i = 0; i < 9; i++) {
        events.push(sample({ host: 'x.test', url, decision: 'served_200',
                             range_header: 'bytes=0-99', elapsed_ms: 30 }));
      }
      events.push(sample({ host: 'x.test', url, decision: 'stored_new',
                           range_header: null, elapsed_ms: 200 }));
      repo.insertBatch(events);

      const agg = repo.diagnoseAggregate({ host: 'x.test', url, periodSec: 3600 });
      expect(agg.sample_count).toBe(10);
      expect(agg.hit_ratio_pct).toBe(90);
      expect(agg.origin_sample_count).toBe(1);
      expect(agg.avg_origin_rtt_ms).toBe(200);
      expect(agg.range_single_count).toBe(9);
      expect(agg.range_none_count).toBe(1);
      expect(agg.range_multi_count).toBe(0);
      expect(agg.bypass_count).toBe(0);
      expect(agg.error_5xx).toBe(0);
      expect(agg.timeout_count).toBe(0);
    });

    it('period 밖 이벤트는 집계되지 않는다', () => {
      const ancient = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      repo.insert(sample({ ts: ancient, host: 'x.test', url: 'https://x.test/u',
                           decision: 'served_200', range_header: 'bytes=0-1', elapsed_ms: 10 }));
      const agg = repo.diagnoseAggregate({ host: 'x.test', url: 'https://x.test/u', periodSec: 3600 });
      expect(agg.sample_count).toBe(0);
      expect(agg.hit_ratio_pct).toBeNull();
    });

    it('5xx · timeout · bypass decision을 분리 집계한다', () => {
      const url = 'https://x.test/e';
      repo.insertBatch([
        sample({ host: 'x.test', url, decision: 'origin_error_5xx', elapsed_ms: 0, range_header: null }),
        sample({ host: 'x.test', url, decision: 'origin_timeout',   elapsed_ms: 0, range_header: null }),
        sample({ host: 'x.test', url, decision: 'bypass_method',    elapsed_ms: 0, range_header: null }),
      ]);
      const agg = repo.diagnoseAggregate({ host: 'x.test', url, periodSec: 3600 });
      expect(agg.error_5xx).toBe(1);
      expect(agg.timeout_count).toBe(1);
      expect(agg.bypass_count).toBe(1);
    });

    it('다른 host 의 동일 url 은 섞이지 않는다', () => {
      const url = 'https://x.test/v';
      repo.insertBatch([
        sample({ host: 'x.test', url, decision: 'served_200', range_header: null, elapsed_ms: 10 }),
        sample({ host: 'y.test', url, decision: 'served_200', range_header: null, elapsed_ms: 10 }),
      ]);
      const agg = repo.diagnoseAggregate({ host: 'x.test', url, periodSec: 3600 });
      expect(agg.sample_count).toBe(1);
    });
  });

  // ─── findHostsWithRecentDecision (#430) ─────────────────────────────────
  describe('findHostsWithRecentDecision', () => {
    it('지정 윈도우 이내 + 일치 decision 의 호스트만 DISTINCT 반환', () => {
      const now = Math.floor(Date.now() / 1000);
      repo.insert(sample({ host: 'a.test', decision: 'served_stale_if_error', ts: new Date((now - 60)  * 1000).toISOString() }));
      repo.insert(sample({ host: 'a.test', decision: 'served_stale_if_error', ts: new Date((now - 120) * 1000).toISOString() }));
      repo.insert(sample({ host: 'b.test', decision: 'served_stale_if_error', ts: new Date((now - 300) * 1000).toISOString() }));
      // 다른 decision 은 제외
      repo.insert(sample({ host: 'c.test', decision: 'served_200',            ts: new Date((now - 30)  * 1000).toISOString() }));
      // 윈도우 밖
      repo.insert(sample({ host: 'd.test', decision: 'served_stale_if_error', ts: new Date((now - 9999) * 1000).toISOString() }));

      const hosts = repo.findHostsWithRecentDecision('served_stale_if_error', now - 600);
      expect(hosts).toEqual(['a.test', 'b.test']); // 가나다순, DISTINCT
    });

    it('일치 이벤트 없으면 빈 배열', () => {
      expect(repo.findHostsWithRecentDecision('served_stale_if_error', 0)).toEqual([]);
    });
  });

  // ─── 인덱스 회귀: (event_type, ts) — #378 ──────────────────────────────
  describe('schema 인덱스 (#378)', () => {
    /**
     * UI 의 'event_type 단독 필터 + 최근 N건' 쿼리(`WHERE event_type = ? ORDER BY ts DESC LIMIT N`)는
     * 기존 인덱스(host_ts / type_decision / ts) 만으로는 ORDER BY 를 만족시키지 못해
     * SQLite 가 TEMP B-TREE 를 만들어 정렬했다. (event_type, ts) 복합 인덱스가 추가되었으므로
     * EXPLAIN QUERY PLAN 결과에 'TEMP B-TREE' 가 나타나지 않아야 한다.
     */
    it('event_type 단독 필터 + ts 정렬 쿼리는 TEMP B-TREE 없이 인덱스로 처리된다', () => {
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT * FROM optimization_events
             WHERE event_type = ?
             ORDER BY ts DESC
             LIMIT 100`,
        )
        .all('image_optimize') as Array<{ detail: string }>;
      const detail = plan.map((p) => p.detail).join('\n');
      expect(detail).not.toMatch(/TEMP B-TREE/);
      // 신규 인덱스가 실제 선택되었는지도 확인 (옵티마이저가 어느 인덱스를 골랐는지 명시)
      expect(detail).toMatch(/idx_opt_events_type_ts/);
    });
  });
});
