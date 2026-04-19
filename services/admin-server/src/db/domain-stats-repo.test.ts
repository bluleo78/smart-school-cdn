import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DomainStatsRepository } from './domain-stats-repo.js';

const SCHEMA = `
  CREATE TABLE domain_stats (
    host TEXT NOT NULL, timestamp INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0, cache_misses INTEGER NOT NULL DEFAULT 0,
    bandwidth INTEGER NOT NULL DEFAULT 0, avg_response_time INTEGER NOT NULL DEFAULT 0,
    l1_hits INTEGER NOT NULL DEFAULT 0, l2_hits INTEGER NOT NULL DEFAULT 0,
    bypass_method INTEGER NOT NULL DEFAULT 0, bypass_nocache INTEGER NOT NULL DEFAULT 0,
    bypass_size INTEGER NOT NULL DEFAULT 0, bypass_other INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (host, timestamp)
  );`;

function makeRepo() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return new DomainStatsRepository(db);
}

describe('DomainStatsRepository — 1h / custom 확장', () => {
  let repo: DomainStatsRepository;
  const host = 'a.test';

  beforeEach(() => { repo = makeRepo(); });

  it('custom 기간은 from/to 범위만 집계한다', () => {
    const now = Math.floor(Date.now() / 1000);
    repo.insert({
      host, timestamp: now - 7200, requests: 100, cache_hits: 50, cache_misses: 50,
      bandwidth: 0, avg_response_time: 0, l1_hits: 40, l2_hits: 10,
      bypass_method: 0, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
    });
    repo.insert({
      host, timestamp: now - 1800, requests: 30, cache_hits: 20, cache_misses: 10,
      bandwidth: 0, avg_response_time: 0, l1_hits: 15, l2_hits: 5,
      bypass_method: 0, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
    });
    // from = now-3600, to = now → 뒤쪽 것만 포함
    const r = repo.getStats(host, 'custom', { from: now - 3600, to: now });
    expect(r.summary.total_requests).toBe(30);
  });

  it('custom 기간에 from/to 가 없거나 to <= from 이면 에러', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => repo.getStats(host, 'custom')).toThrow();
    expect(() => repo.getStats(host, 'custom', { from: now, to: now - 1 })).toThrow();
  });

  it('1h 기간은 60초 버킷으로 집계한다', () => {
    const now = Math.floor(Date.now() / 1000);
    // 10분 전과 5분 전 각각 1건
    repo.insert({
      host, timestamp: now - 600, requests: 10, cache_hits: 6, cache_misses: 4,
      bandwidth: 1024, avg_response_time: 20, l1_hits: 5, l2_hits: 1,
      bypass_method: 0, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
    });
    repo.insert({
      host, timestamp: now - 300, requests: 20, cache_hits: 15, cache_misses: 5,
      bandwidth: 2048, avg_response_time: 30, l1_hits: 14, l2_hits: 1,
      bypass_method: 0, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
    });
    const r = repo.getStats(host, '1h');
    expect(r.summary.total_requests).toBe(30);
    // 1h 내 두 개의 버킷(60초 단위로 다른 버킷)
    expect(r.timeseries.length).toBeGreaterThanOrEqual(2);
  });
});
