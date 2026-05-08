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

  // getSummaryForHost가 SQL 단계에서 host 필터를 적용하면서도
  // getSummaryAll().find()와 동일한 결과(계약)를 반환해야 함을 검증한다.
  it('getSummaryForHost는 getSummaryAll().find()와 동일한 결과를 반환한다 (다중 host)', () => {
    const now = Math.floor(Date.now() / 1000);
    const todayStart = now - (now % 86400);
    // 두 host 데이터 — 오늘 + 어제 + 24시간 시간별 분포 다양화
    const insertRow = (h: string, ts: number, req: number, hit: number, l1: number, l2: number, bypass: number) =>
      repo.insert({
        host: h, timestamp: ts, requests: req, cache_hits: hit, cache_misses: req - hit,
        bandwidth: req * 100, avg_response_time: 10, l1_hits: l1, l2_hits: l2,
        bypass_method: bypass, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
      });
    // a.test
    insertRow('a.test', todayStart + 100,  50, 30, 20, 10, 5);
    insertRow('a.test', todayStart + 4000, 70, 40, 25, 15, 7);
    insertRow('a.test', todayStart - 86400 + 100, 100, 60, 0, 0, 0); // 어제
    // b.test
    insertRow('b.test', todayStart + 200, 200, 150, 100, 50, 10);
    insertRow('b.test', todayStart - 86400 + 200, 80, 40, 0, 0, 0); // 어제

    const all = repo.getSummaryAll();
    for (const expected of all) {
      const actual = repo.getSummaryForHost(expected.host);
      expect(actual).toEqual(expected);
    }
  });

  it('getSummaryForHost는 오늘 데이터가 없는 host에 대해 undefined를 반환한다', () => {
    const now = Math.floor(Date.now() / 1000);
    const todayStart = now - (now % 86400);
    // 어제만 있는 host (오늘 윈도우엔 행이 없음)
    repo.insert({
      host: 'old.test', timestamp: todayStart - 1000, requests: 10, cache_hits: 5, cache_misses: 5,
      bandwidth: 0, avg_response_time: 0, l1_hits: 0, l2_hits: 0,
      bypass_method: 0, bypass_nocache: 0, bypass_size: 0, bypass_other: 0,
    });
    expect(repo.getSummaryForHost('old.test')).toBeUndefined();
    expect(repo.getSummaryForHost('never-seen.test')).toBeUndefined();
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
