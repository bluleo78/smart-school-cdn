import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DnsMetricsRepository, DNS_METRICS_SCHEMA } from './db/dns-metrics-repo.js';
import { DnsMetricsCollector, type CollectorOpts } from './dns-metrics-collector.js';
import type { StatsResponse } from './grpc/dns_client.js';

function mkStats(partial: Partial<StatsResponse> = {}): StatsResponse {
  // shared.ts의 longs: String 때문에 숫자 필드는 string 타입 — 테스트도 string으로 줌
  return {
    total_queries: '0',
    matched: '0',
    nxdomain: '0',
    forwarded: '0',
    uptime_secs: '0',
    top_domains: [],
    ...partial,
  } as StatsResponse;
}

function mkRepo() {
  const db = new Database(':memory:');
  db.exec(DNS_METRICS_SCHEMA);
  return { db, repo: new DnsMetricsRepository(db) };
}

function quietLog(): CollectorOpts['log'] {
  return { warn: () => {}, info: () => {}, error: () => {} };
}

describe('DnsMetricsCollector', () => {
  it('첫 스냅샷은 델타 저장을 스킵한다', async () => {
    const { repo } = mkRepo();
    const getStats = vi.fn().mockResolvedValue(mkStats({ total_queries: '100', matched: '80' }));
    const c = new DnsMetricsCollector({ getStats, repo, now: () => 60_000, log: quietLog() });
    await c.tick();
    expect(repo.range(0, 1_000_000)).toEqual([]);
  });

  it('두 번째 이후는 델타를 현재 분 버킷에 누적한다', async () => {
    const { repo } = mkRepo();
    const getStats = vi.fn()
      .mockResolvedValueOnce(mkStats({ total_queries: '100', matched: '80', nxdomain: '5',  forwarded: '15' }))
      .mockResolvedValueOnce(mkStats({ total_queries: '150', matched: '120', nxdomain: '5', forwarded: '25' }));
    const c = new DnsMetricsCollector({ getStats, repo, now: () => 60_000, log: quietLog() });
    await c.tick();
    await c.tick();
    expect(repo.range(0, 1_000_000)).toEqual([
      { bucket_ts: 60_000, total: 50, matched: 40, nxdomain: 0, forwarded: 10 },
    ]);
  });

  it('총량이 감소하면(dns-service 재시작) delta = current', async () => {
    const { repo } = mkRepo();
    const getStats = vi.fn()
      .mockResolvedValueOnce(mkStats({ total_queries: '1000', matched: '800', nxdomain: '50', forwarded: '150' }))
      .mockResolvedValueOnce(mkStats({ total_queries: '20',   matched: '15',  nxdomain: '2',  forwarded: '3' }));
    const c = new DnsMetricsCollector({ getStats, repo, now: () => 120_000, log: quietLog() });
    await c.tick();
    await c.tick();
    expect(repo.range(0, 1_000_000)).toEqual([
      { bucket_ts: 120_000, total: 20, matched: 15, nxdomain: 2, forwarded: 3 },
    ]);
  });

  it('24시간 초과 행을 prune한다', async () => {
    const { repo } = mkRepo();
    repo.upsertDelta(0,         { total: 1, matched: 0, nxdomain: 0, forwarded: 0 });
    repo.upsertDelta(1_000_000, { total: 1, matched: 0, nxdomain: 0, forwarded: 0 });
    const getStats = vi.fn().mockResolvedValue(mkStats({ total_queries: '10' }));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const c = new DnsMetricsCollector({ getStats, repo, now: () => DAY_MS + 500_000, log: quietLog() });
    await c.tick();
    const rows = repo.range(0, Number.MAX_SAFE_INTEGER);
    expect(rows.map(r => r.bucket_ts)).toEqual([1_000_000]);
  });

  it('gRPC 실패 시 조용히 스킵한다', async () => {
    const { repo } = mkRepo();
    const getStats = vi.fn().mockRejectedValue(new Error('offline'));
    const c = new DnsMetricsCollector({ getStats, repo, now: () => 60_000, log: quietLog() });
    await expect(c.tick()).resolves.not.toThrow();
    expect(repo.range(0, 1_000_000)).toEqual([]);
  });
});
