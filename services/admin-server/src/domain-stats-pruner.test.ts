import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DomainStatsRepository } from './db/domain-stats-repo.js';
import {
  DomainStatsPruner,
  startDomainStatsPruner,
  type DomainStatsPrunerOpts,
} from './domain-stats-pruner.js';

// 콘솔 잡음 차단 — optimization-events-pruner.test.ts와 동일 패턴
function quietLog(): DomainStatsPrunerOpts['log'] {
  return { warn: () => {}, info: () => {}, error: () => {} };
}

/**
 * domain_stats 테스트 픽스처 — index.ts의 CREATE TABLE 정의와 컬럼을 동일하게 맞춘다.
 * Phase 12 신규 컬럼(l1_hits/l2_hits/bypass_*)까지 포함.
 * domains FK 는 :memory: 환경 단순화를 위해 테스트에선 제거.
 */
const STATS_SCHEMA = `
  CREATE TABLE domain_stats (
    host TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
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
`;

const DAY_MS = 24 * 60 * 60 * 1000;
// 절대 시간 기준점 — 테스트가 항상 같은 시각에서 실행되도록 고정
const NOW = Date.UTC(2026, 0, 31, 0, 0, 0); // 2026-01-31T00:00:00Z

function mkRepo() {
  const db = new Database(':memory:');
  db.exec(STATS_SCHEMA);
  return { db, repo: new DomainStatsRepository(db) };
}

/** Unix 초 단위 — domain_stats.timestamp 컬럼 형식과 동일 */
function tsMinusDays(days: number): number {
  return Math.floor((NOW - days * DAY_MS) / 1000);
}

function insertAt(db: Database.Database, ts: number) {
  db.prepare(
    `INSERT INTO domain_stats (host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time)
     VALUES (?, ?, 1, 0, 1, 0, 0)`,
  ).run('h.example.com', ts);
}

describe('DomainStatsPruner', () => {
  it('30일 이전 통계만 삭제하고 30일 이내는 유지한다', () => {
    const { db, repo } = mkRepo();
    insertAt(db, tsMinusDays(31));
    insertAt(db, tsMinusDays(40));
    insertAt(db, tsMinusDays(29));
    insertAt(db, tsMinusDays(1));

    const pruner = new DomainStatsPruner({ repo, now: () => NOW, log: quietLog() });
    const removed = pruner.tick();

    expect(removed).toBe(2);
    const rows = db
      .prepare('SELECT timestamp FROM domain_stats ORDER BY timestamp ASC')
      .all() as Array<{ timestamp: number }>;
    expect(rows.map((r) => r.timestamp)).toEqual([tsMinusDays(29), tsMinusDays(1)]);
  });

  it('retentionDays 옵션이 환경변수보다 우선한다', () => {
    const prev = process.env.DOMAIN_STATS_RETENTION_DAYS;
    process.env.DOMAIN_STATS_RETENTION_DAYS = '90';
    try {
      const { db, repo } = mkRepo();
      insertAt(db, tsMinusDays(8));
      insertAt(db, tsMinusDays(3));
      const pruner = new DomainStatsPruner({
        repo,
        now: () => NOW,
        retentionDays: 7,
        log: quietLog(),
      });
      expect(pruner.tick()).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.DOMAIN_STATS_RETENTION_DAYS;
      else process.env.DOMAIN_STATS_RETENTION_DAYS = prev;
    }
  });

  it('DOMAIN_STATS_RETENTION_DAYS 환경변수로 retention 변경 가능하다', () => {
    const prev = process.env.DOMAIN_STATS_RETENTION_DAYS;
    process.env.DOMAIN_STATS_RETENTION_DAYS = '7';
    try {
      const { db, repo } = mkRepo();
      insertAt(db, tsMinusDays(10));
      insertAt(db, tsMinusDays(5));
      const pruner = new DomainStatsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(pruner.tick()).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.DOMAIN_STATS_RETENTION_DAYS;
      else process.env.DOMAIN_STATS_RETENTION_DAYS = prev;
    }
  });

  it('잘못된 환경변수는 무시하고 기본 30일을 사용한다', () => {
    const prev = process.env.DOMAIN_STATS_RETENTION_DAYS;
    process.env.DOMAIN_STATS_RETENTION_DAYS = 'not-a-number';
    try {
      const { db, repo } = mkRepo();
      insertAt(db, tsMinusDays(31));
      insertAt(db, tsMinusDays(20));
      const pruner = new DomainStatsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(pruner.tick()).toBe(1); // 31일치만 삭제, 20일치는 보존
    } finally {
      if (prev === undefined) delete process.env.DOMAIN_STATS_RETENTION_DAYS;
      else process.env.DOMAIN_STATS_RETENTION_DAYS = prev;
    }
  });

  it('repo.pruneBefore 예외는 삼키고 0을 반환한다', () => {
    const repo = {
      pruneBefore: vi.fn(() => {
        throw new Error('disk i/o');
      }),
    } as unknown as DomainStatsRepository;
    const pruner = new DomainStatsPruner({ repo, now: () => NOW, log: quietLog() });
    expect(() => pruner.tick()).not.toThrow();
    expect(pruner.tick()).toBe(0);
  });
});

describe('startDomainStatsPruner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('부팅 즉시 1회 prune 후 interval에 따라 반복한다', () => {
    const { repo } = mkRepo();
    const spy = vi.spyOn(repo, 'pruneBefore');
    const handle = startDomainStatsPruner(
      { repo, now: () => NOW, log: quietLog() },
      1_000,
    );
    expect(spy).toHaveBeenCalledTimes(1); // 즉시 1회
    vi.advanceTimersByTime(3_500);
    expect(spy).toHaveBeenCalledTimes(4); // 1초·2초·3초 추가
    handle.stop();
    vi.advanceTimersByTime(5_000);
    expect(spy).toHaveBeenCalledTimes(4); // stop 이후 미호출
  });
});
