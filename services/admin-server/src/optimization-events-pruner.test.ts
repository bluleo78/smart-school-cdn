import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  OPTIMIZATION_EVENTS_SCHEMA,
  OptimizationEventsRepository,
} from './db/optimization-events-repo.js';
import {
  OptimizationEventsPruner,
  startOptimizationEventsPruner,
  type PrunerOpts,
} from './optimization-events-pruner.js';

// 콘솔 잡음 차단용 — collector 테스트와 동일 패턴
function quietLog(): PrunerOpts['log'] {
  return { warn: () => {}, info: () => {}, error: () => {} };
}

function mkRepo() {
  const db = new Database(':memory:');
  db.exec(OPTIMIZATION_EVENTS_SCHEMA);
  return { db, repo: new OptimizationEventsRepository(db) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 절대 시간 기준점 — 테스트가 항상 같은 시각에서 실행되도록 고정
const NOW = Date.UTC(2026, 0, 31, 0, 0, 0); // 2026-01-31T00:00:00Z

function isoMinusDays(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function insertAt(repo: OptimizationEventsRepository, ts: string) {
  repo.insert({
    ts,
    event_type: 'media_cache',
    host: 'h.example.com',
    url: 'https://h.example.com/a',
    decision: 'served_200',
    elapsed_ms: 1,
  });
}

describe('OptimizationEventsPruner', () => {
  it('30일 이전 이벤트만 삭제하고 30일 이내는 유지한다', () => {
    const { db, repo } = mkRepo();
    insertAt(repo, isoMinusDays(31));
    insertAt(repo, isoMinusDays(40));
    insertAt(repo, isoMinusDays(29));
    insertAt(repo, isoMinusDays(1));

    const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
    const removed = pruner.tick();

    expect(removed).toBe(2);
    const rows = db
      .prepare('SELECT ts FROM optimization_events ORDER BY ts ASC')
      .all() as Array<{ ts: string }>;
    expect(rows.map((r) => r.ts)).toEqual([isoMinusDays(29), isoMinusDays(1)]);
  });

  it('retentionDays 옵션이 환경변수보다 우선한다', () => {
    const prev = process.env.OPT_EVENTS_RETENTION_DAYS;
    process.env.OPT_EVENTS_RETENTION_DAYS = '90';
    try {
      const { repo } = mkRepo();
      insertAt(repo, isoMinusDays(8));
      insertAt(repo, isoMinusDays(3));
      const pruner = new OptimizationEventsPruner({
        repo,
        now: () => NOW,
        retentionDays: 7,
        log: quietLog(),
      });
      expect(pruner.tick()).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.OPT_EVENTS_RETENTION_DAYS;
      else process.env.OPT_EVENTS_RETENTION_DAYS = prev;
    }
  });

  it('OPT_EVENTS_RETENTION_DAYS 환경변수로 retention 변경 가능하다', () => {
    const prev = process.env.OPT_EVENTS_RETENTION_DAYS;
    process.env.OPT_EVENTS_RETENTION_DAYS = '7';
    try {
      const { repo } = mkRepo();
      insertAt(repo, isoMinusDays(10));
      insertAt(repo, isoMinusDays(5));
      const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(pruner.tick()).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.OPT_EVENTS_RETENTION_DAYS;
      else process.env.OPT_EVENTS_RETENTION_DAYS = prev;
    }
  });

  it('잘못된 환경변수는 무시하고 기본 30일을 사용한다', () => {
    const prev = process.env.OPT_EVENTS_RETENTION_DAYS;
    process.env.OPT_EVENTS_RETENTION_DAYS = 'not-a-number';
    try {
      const { repo } = mkRepo();
      insertAt(repo, isoMinusDays(31));
      insertAt(repo, isoMinusDays(20));
      const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(pruner.tick()).toBe(1); // 31일치만 삭제, 20일치는 보존
    } finally {
      if (prev === undefined) delete process.env.OPT_EVENTS_RETENTION_DAYS;
      else process.env.OPT_EVENTS_RETENTION_DAYS = prev;
    }
  });

  it('repo.prune 예외는 삼키고 0을 반환한다', () => {
    const repo = {
      prune: vi.fn(() => {
        throw new Error('disk i/o');
      }),
    } as unknown as OptimizationEventsRepository;
    const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
    expect(() => pruner.tick()).not.toThrow();
    expect(pruner.tick()).toBe(0);
  });
});

describe('startOptimizationEventsPruner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('부팅 즉시 1회 prune 후 interval에 따라 반복한다', () => {
    const { repo } = mkRepo();
    const spy = vi.spyOn(repo, 'prune');
    const handle = startOptimizationEventsPruner(
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
