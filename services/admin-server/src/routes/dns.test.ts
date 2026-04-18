import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DnsMetricsRepository, DNS_METRICS_SCHEMA } from '../db/dns-metrics-repo.js';
import { dnsRoutes } from './dns.js';
import type {
  DnsClient, StatsResponse, RecentQueriesResponse, RecordsResponse,
} from '../grpc/dns_client.js';

type Overrides = {
  getStats?: () => Promise<StatsResponse>;
  getRecentQueries?: (limit?: number) => Promise<RecentQueriesResponse>;
  getRecords?: () => Promise<RecordsResponse>;
  health?: () => Promise<{ online: boolean; latency_ms: number }>;
};

function mkApp(overrides: Overrides = {}) {
  const db = new Database(':memory:');
  db.exec(DNS_METRICS_SCHEMA);
  const repo = new DnsMetricsRepository(db);

  const dnsClient = {
    getStats:         overrides.getStats ?? (async () => ({
      total_queries: '0',
      matched: '0',
      nxdomain: '0',
      forwarded: '0',
      uptime_secs: '0',
      top_domains: [],
    } satisfies StatsResponse)),
    getRecentQueries: overrides.getRecentQueries ?? (async () => ({ entries: [] })),
    getRecords:       overrides.getRecords ?? (async () => ({ records: [] })),
    health:           overrides.health ?? (async () => ({ online: true, latency_ms: 1 })),
    syncDomains:      async () => ({ success: true }),
  };

  const app = Fastify({ logger: false });
  app.decorate('dnsClient', dnsClient as unknown as DnsClient);
  app.decorate('dnsMetricsRepo', repo);
  app.register(dnsRoutes);
  return { app, repo };
}

describe('dnsRoutes', () => {
  it('GET /api/dns/status — 정상 응답 + 숫자 타입으로 변환', async () => {
    const { app } = mkApp({
      getStats: async () => ({
        total_queries: '10',
        matched: '7',
        nxdomain: '1',
        forwarded: '2',
        uptime_secs: '42',
        top_domains: [{ qname: 'a.test', count: 3 }],
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.online).toBe(true);
    expect(body.total).toBe(10);           // number, not '10'
    expect(body.matched).toBe(7);
    expect(body.nxdomain).toBe(1);
    expect(body.forwarded).toBe(2);
    expect(body.uptime_secs).toBe(42);
    expect(body.top_domains).toEqual([{ qname: 'a.test', count: 3 }]);
  });

  it('GET /api/dns/status — dns-service 오프라인 시 online=false + 0 값', async () => {
    const { app } = mkApp({
      getStats: async () => { throw new Error('offline'); },
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      online: false,
      uptime_secs: 0,
      total: 0, matched: 0, nxdomain: 0, forwarded: 0,
      top_domains: [],
    });
  });

  it('GET /api/dns/records — 리스트 반환', async () => {
    const { app } = mkApp({
      getRecords: async () => ({
        records: [{ host: 'edu.test', target: '10.0.0.2', rtype: 'A', source: 'auto' }],
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/records' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      records: [{ host: 'edu.test', target: '10.0.0.2', rtype: 'A', source: 'auto' }],
    });
  });

  it('GET /api/dns/queries?limit=50 — dns-service에 limit 전달 + ts_unix_ms number 변환', async () => {
    const captured: number[] = [];
    const { app } = mkApp({
      getRecentQueries: async (limit?: number) => {
        captured.push(limit ?? -1);
        return {
          entries: [{
            ts_unix_ms: '1234567890123',
            client_ip: '10.0.0.1',
            qname: 'a.test',
            qtype: 'A',
            result: 'matched',
            latency_us: 100,
          }],
        };
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/queries?limit=50' });
    expect(res.statusCode).toBe(200);
    expect(captured[0]).toBe(50);
    const body = res.json();
    expect(body.entries[0].ts_unix_ms).toBe(1234567890123); // number
    expect(body.entries[0].latency_us).toBe(100);
    expect(body.entries[0].result).toBe('matched');
  });

  it('GET /api/dns/queries (default limit) — 기본 100', async () => {
    const captured: number[] = [];
    const { app } = mkApp({
      getRecentQueries: async (limit?: number) => {
        captured.push(limit ?? -1);
        return { entries: [] };
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/queries' });
    expect(res.statusCode).toBe(200);
    expect(captured[0]).toBe(100);
  });

  it('GET /api/dns/metrics?range=1h — SQLite range 조회', async () => {
    const { app, repo } = mkApp();
    const now = Date.now();
    repo.upsertDelta(Math.floor((now - 30 * 60_000) / 60_000) * 60_000, {
      total: 5, matched: 5, nxdomain: 0, forwarded: 0,
    });
    const res = await app.inject({ method: 'GET', url: '/api/dns/metrics?range=1h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.buckets.length).toBe(1);
    expect(body.buckets[0].total).toBe(5);
    expect(typeof body.buckets[0].ts).toBe('number');
  });

  it('GET /api/dns/metrics?range=24h — 기본 24시간', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/dns/metrics?range=24h' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ buckets: [] });
  });

  it('GET /api/dns/metrics?range=invalid — 400', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/dns/metrics?range=7d' });
    expect(res.statusCode).toBe(400);
  });
});
