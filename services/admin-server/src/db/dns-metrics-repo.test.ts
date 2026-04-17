import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DnsMetricsRepository, DNS_METRICS_SCHEMA } from './dns-metrics-repo.js';

let db: Database.Database;
let repo: DnsMetricsRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(DNS_METRICS_SCHEMA);
  repo = new DnsMetricsRepository(db);
});

describe('DnsMetricsRepository', () => {
  it('upsertDelta는 없는 버킷을 생성한다', () => {
    repo.upsertDelta(60_000, { total: 10, matched: 7, nxdomain: 1, forwarded: 2 });
    const rows = repo.range(0, 120_000);
    expect(rows).toEqual([
      { bucket_ts: 60_000, total: 10, matched: 7, nxdomain: 1, forwarded: 2 },
    ]);
  });

  it('upsertDelta는 같은 버킷에 누적 가산한다', () => {
    repo.upsertDelta(60_000, { total: 5, matched: 3, nxdomain: 0, forwarded: 2 });
    repo.upsertDelta(60_000, { total: 4, matched: 2, nxdomain: 1, forwarded: 1 });
    const rows = repo.range(0, 120_000);
    expect(rows[0]).toEqual({
      bucket_ts: 60_000, total: 9, matched: 5, nxdomain: 1, forwarded: 3,
    });
  });

  it('range는 지정 범위만 반환하고 시간 오름차순', () => {
    repo.upsertDelta(60_000,  { total: 1, matched: 1, nxdomain: 0, forwarded: 0 });
    repo.upsertDelta(120_000, { total: 2, matched: 2, nxdomain: 0, forwarded: 0 });
    repo.upsertDelta(180_000, { total: 3, matched: 3, nxdomain: 0, forwarded: 0 });
    const rows = repo.range(100_000, 200_000);
    expect(rows.map(r => r.bucket_ts)).toEqual([120_000, 180_000]);
  });

  it('prune은 기준 이전 행을 삭제한다', () => {
    repo.upsertDelta(60_000,  { total: 1, matched: 0, nxdomain: 0, forwarded: 0 });
    repo.upsertDelta(120_000, { total: 1, matched: 0, nxdomain: 0, forwarded: 0 });
    const removed = repo.prune(100_000);
    expect(removed).toBe(1);
    expect(repo.range(0, 200_000).map(r => r.bucket_ts)).toEqual([120_000]);
  });
});
