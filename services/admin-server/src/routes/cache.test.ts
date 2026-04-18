/// 캐시 라우트 유닛 테스트
/// storageClient Fastify 데코레이터를 모킹하여 gRPC 기반 캐시 API를 검증한다.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { cacheRoutes } from './cache.js';

/** domain_stats 스키마 — 6개 신규 컬럼 포함 */
const DOMAIN_STATS_SCHEMA = `
  CREATE TABLE domain_stats (
    host TEXT NOT NULL, timestamp INTEGER NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_misses INTEGER NOT NULL DEFAULT 0,
    bandwidth INTEGER NOT NULL DEFAULT 0,
    avg_response_time INTEGER NOT NULL DEFAULT 0,
    l1_hits INTEGER NOT NULL DEFAULT 0,
    l2_hits INTEGER NOT NULL DEFAULT 0,
    bypass_method INTEGER NOT NULL DEFAULT 0,
    bypass_nocache INTEGER NOT NULL DEFAULT 0,
    bypass_size INTEGER NOT NULL DEFAULT 0,
    bypass_other INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (host, timestamp)
  );
  CREATE INDEX idx_domain_stats_ts ON domain_stats(timestamp);
`;

/** storageClient 전체 mock — stats/popular/purge* 포함 */
function makeStorageMock(statsImpl: () => Promise<{ used_bytes: number; total_bytes: number }>) {
  return {
    stats:       statsImpl,
    popular:     vi.fn<() => Promise<{ entries: unknown[] }>>(),
    purgeUrl:    vi.fn<(u: string) => Promise<unknown>>(),
    purgeDomain: vi.fn<(d: string) => Promise<unknown>>(),
    purgeAll:    vi.fn<() => Promise<unknown>>(),
    health:      vi.fn<() => Promise<unknown>>(),
  };
}

/**
 * 테스트용 Fastify 앱 생성 — in-memory SQLite + storageClient mock 주입
 * @param opts.storage - storageClient mock (makeStorageMock으로 생성)
 */
function mkApp(opts: { storage: ReturnType<typeof makeStorageMock> }) {
  const db = new Database(':memory:');
  db.exec(DOMAIN_STATS_SCHEMA);

  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('db', db as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('storageClient', opts.storage as any);

  // 등록은 동기로 처리하기 위해 ready() 전에 register 호출 — inject()가 자동으로 ready를 트리거
  app.register(cacheRoutes);

  return { app, db };
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// ─── GET /api/cache/stats (재설계) ───────────────────────────────────────────

describe('GET /api/cache/stats (재설계)', () => {
  it('빈 DB일 때 모든 비율이 0이고 disk는 storage 값', async () => {
    const { app } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      requests: 0, l1_hits: 0, l2_hits: 0, miss: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0, edge_hit_rate: 0, bypass_rate: 0,
      disk: { used_bytes: 0, max_bytes: 0, entry_count: 0 },
      by_domain: [],
    });
  });

  it('샘플 데이터에서 비율 정확히 계산 + by_domain 포함', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 1000, total_bytes: 10000 })),
    });
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (
      'a.test', ?, 100, 70, 10, 2048, 12,
      60, 10, 15, 5, 0, 0
    )`).run(nowSec() - 100);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.requests).toBe(100);
    expect(body.l1_hits).toBe(60);
    expect(body.l2_hits).toBe(10);
    expect(body.miss).toBe(10);
    expect(body.bypass).toEqual({ method: 15, nocache: 5, size: 0, other: 0, total: 20 });
    expect(body.l1_hit_rate).toBeCloseTo(0.60);
    expect(body.edge_hit_rate).toBeCloseTo(0.70);
    expect(body.bypass_rate).toBeCloseTo(0.20);
    expect(body.disk).toEqual({ used_bytes: 1000, max_bytes: 10000, entry_count: 0 });
    expect(body.by_domain).toHaveLength(1);
    expect(body.by_domain[0]).toMatchObject({
      host: 'a.test', requests: 100, l1_hits: 60, l2_hits: 10, bypass_total: 20,
    });
    expect(body.by_domain[0].l1_hit_rate).toBeCloseTo(0.60);
    expect(body.by_domain[0].edge_hit_rate).toBeCloseTo(0.70);
  });

  it('storage gRPC 실패 시 disk는 0, 나머지는 정상', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => { throw new Error('offline'); }),
    });
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (
      'a.test', ?, 10, 7, 3, 0, 0,
      7, 0, 0, 0, 0, 0
    )`).run(nowSec() - 100);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.disk).toEqual({ used_bytes: 0, max_bytes: 0, entry_count: 0 });
    expect(body.l1_hit_rate).toBeCloseTo(0.7);
  });

  it('by_domain이 요청수 내림차순 + LIMIT 20', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const stmt = db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`);
    const ts = nowSec() - 100;
    for (let i = 0; i < 25; i++) {
      stmt.run(`h${i}.test`, ts, (25 - i) * 10);
    }

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.by_domain).toHaveLength(20);
    expect(body.by_domain[0].host).toBe('h0.test');
    expect(body.by_domain[0].requests).toBe(250);
    expect(body.by_domain[19].host).toBe('h19.test');
  });

  it('24시간 이전 데이터는 집계 제외', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const stmt = db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0)`);
    stmt.run('old', nowSec() - 86400 - 100, 9999, 9999, 9999);
    stmt.run('new', nowSec() - 100, 5, 5, 5);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.requests).toBe(5);
    expect(body.by_domain.map((d: { host: string }) => d.host)).toEqual(['new']);
  });
});

// ─── GET /api/cache/popular ──────────────────────────────────────────────────

describe('GET /api/cache/popular', () => {
  it('정상 응답 시 인기 콘텐츠 목록을 반환한다', async () => {
    const entries = [
      { url: 'https://example.com/video.mp4', hit_count: 200 },
      { url: 'https://example.com/image.png', hit_count: 150 },
    ];
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.popular.mockResolvedValueOnce({ entries });
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(entries);
  });

  it('storage-service 연결 실패 시 빈 배열을 반환한다', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.popular.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ─── DELETE /api/cache/purge ──────────────────────────────────────────────────

describe('DELETE /api/cache/purge', () => {
  it('type이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('type이 url이고 target이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('type이 domain이고 target이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'domain' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('url 타입 + target 있으면 purgeUrl 호출 후 결과를 반환한다', async () => {
    const purgeResult = { purged_files: 1, freed_bytes: 512 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeUrl.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://example.com/video.mp4' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(purgeResult);
    expect(mock.purgeUrl).toHaveBeenCalledWith('https://example.com/video.mp4');
  });

  it('domain 타입 + target 있으면 purgeDomain 호출 후 결과를 반환한다', async () => {
    const purgeResult = { purged_files: 5, freed_bytes: 2048 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeDomain.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'domain', target: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(purgeResult);
    expect(mock.purgeDomain).toHaveBeenCalledWith('example.com');
  });

  it('all 타입은 target 없이도 purgeAll 호출 후 성공한다', async () => {
    const purgeResult = { purged_files: 100, freed_bytes: 1048576 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeAll.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'all' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(purgeResult);
    expect(mock.purgeAll).toHaveBeenCalled();
  });

  it('storage-service 에러 시 502를 반환한다', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeAll.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'all' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'storage-service에 연결할 수 없습니다.' });
  });
});
