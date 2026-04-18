import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { cacheRoutes } from './cache.js';

function nowSec() { return Math.floor(Date.now() / 1000); }

function mkApp() {
  const db = new Database(':memory:');
  db.exec(`
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
  `);
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('storageClient', {
    stats: async () => ({ used_bytes: 0, total_bytes: 0, entry_count: 0 }),
    popular: async () => ({ entries: [] }),
    purgeUrl: async () => ({}),
    purgeDomain: async () => ({}),
    purgeAll: async () => ({}),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  app.register(cacheRoutes);
  return { app, db };
}

describe('GET /api/cache/series', () => {
  it('range=1h는 분 단위 버킷 반환 + 카운터 집계', async () => {
    const { app, db } = mkApp();
    const t = nowSec() - 120; // 2분 전
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES ('a.test', ?, 10, 8, 1, 0, 0, 7, 1, 1, 0, 0, 0)`).run(t);

    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.buckets.length).toBeGreaterThan(0);
    const bucket = body.buckets[0];
    expect(bucket).toMatchObject({ l1_hits: 7, l2_hits: 1, miss: 1, bypass: 1 });
    expect(typeof bucket.ts).toBe('number');
    // ts는 epoch ms — 현재보다 작고 양수
    expect(bucket.ts).toBeGreaterThan(0);
    expect(bucket.ts).toBeLessThanOrEqual(Date.now());
  });

  it('range=24h는 시간 단위 버킷', async () => {
    const { app, db } = mkApp();
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES ('a.test', ?, 5, 5, 0, 0, 0, 5, 0, 0, 0, 0, 0)`).run(nowSec() - 3600);

    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=24h' });
    expect(res.statusCode).toBe(200);
    expect(res.json().buckets.length).toBeGreaterThan(0);
  });

  it('host 파라미터로 단일 도메인 필터', async () => {
    const { app, db } = mkApp();
    const t = nowSec() - 60;
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0)`).run('a.test', t, 10, 10, 10);
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0)`).run('b.test', t, 20, 20, 20);

    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=1h&host=a.test' });
    const body = res.json();
    const total = body.buckets.reduce(
      (s: number, b: { l1_hits: number }) => s + b.l1_hits, 0);
    expect(total).toBe(10);
  });

  it('빈 기간 → buckets: []', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=1h' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ buckets: [] });
  });

  it('잘못된 range → 400', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=7d' });
    expect(res.statusCode).toBe(400);
  });

  it('여러 버킷이 시간 오름차순 정렬', async () => {
    const { app, db } = mkApp();
    const t0 = nowSec() - 300;  // 5분 전
    const t1 = nowSec() - 120;  // 2분 전
    const t2 = nowSec() - 60;   // 1분 전
    const stmt = db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES ('a.test', ?, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0)`);
    // 의도적으로 역순 insert
    stmt.run(t2);
    stmt.run(t0);
    stmt.run(t1);

    const res = await app.inject({ method: 'GET', url: '/api/cache/series?range=1h' });
    const tss = res.json().buckets.map((b: { ts: number }) => b.ts);
    const sorted = [...tss].sort((a, b) => a - b);
    expect(tss).toEqual(sorted);
  });
});
