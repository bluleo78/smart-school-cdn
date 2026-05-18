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
  // (#379) reconcileOrphans 가 의존하는 domains 테이블도 함께 준비 — 라우트에서 쓰는
  //        실제 스키마의 필수 컬럼만 둔다. 미생성 시 reconcileOrphans 가 SQL 에러 → tick 이 0 반환.
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      host       TEXT PRIMARY KEY,
      origin     TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      enabled    INTEGER NOT NULL DEFAULT 1
    );
  `);
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

/** 기존 retention 테스트용 host 를 domains 에 등록해 reconcileOrphans 와 분리 — 같은 tick 안에서
 *  retention prune 만 검증할 수 있도록 한다 (#379). */
function registerHost(db: Database.Database, host = 'h.example.com') {
  db.prepare(`INSERT OR IGNORE INTO domains (host, origin) VALUES (?, ?)`).run(host, 'https://o');
}

describe('OptimizationEventsPruner', () => {
  it('30일 이전 이벤트만 삭제하고 30일 이내는 유지한다', () => {
    const { db, repo } = mkRepo();
    registerHost(db);
    insertAt(repo, isoMinusDays(31));
    insertAt(repo, isoMinusDays(40));
    insertAt(repo, isoMinusDays(29));
    insertAt(repo, isoMinusDays(1));

    const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
    const removed = pruner.tick();

    expect(removed).toBe(2);
    // #377 이후 ts 는 INTEGER unix-sec. 남은 행을 unix-sec 로 비교한다 (29/1 day-ago).
    const rows = db
      .prepare('SELECT ts FROM optimization_events ORDER BY ts ASC')
      .all() as Array<{ ts: number }>;
    const expected29 = Math.floor((NOW - 29 * DAY_MS) / 1000);
    const expected1  = Math.floor((NOW -  1 * DAY_MS) / 1000);
    expect(rows.map((r) => r.ts)).toEqual([expected29, expected1]);
  });

  it('retentionDays 옵션이 환경변수보다 우선한다', () => {
    const prev = process.env.OPT_EVENTS_RETENTION_DAYS;
    process.env.OPT_EVENTS_RETENTION_DAYS = '90';
    try {
      const { db, repo } = mkRepo();
      registerHost(db);
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
      const { db, repo } = mkRepo();
      registerHost(db);
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
      const { db, repo } = mkRepo();
      registerHost(db);
      insertAt(repo, isoMinusDays(31));
      insertAt(repo, isoMinusDays(20));
      const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(pruner.tick()).toBe(1); // 31일치만 삭제, 20일치는 보존
    } finally {
      if (prev === undefined) delete process.env.OPT_EVENTS_RETENTION_DAYS;
      else process.env.OPT_EVENTS_RETENTION_DAYS = prev;
    }
  });

  // (#379) tick 이 retention prune 외에 reconcileOrphans 도 실행하는지 검증
  it('domains 에 없는 host 의 orphan 이벤트를 reconcile 한다', () => {
    const { db, repo } = mkRepo();
    registerHost(db, 'live.test');
    // retention 안쪽(2일치) 이벤트를 두 host 로 삽입 — orphan 만 정리되는지 확인
    repo.insert({
      ts: isoMinusDays(2),
      event_type: 'media_cache',
      host: 'live.test',
      url: 'https://live.test/a',
      decision: 'served_200',
      elapsed_ms: 1,
    });
    repo.insert({
      ts: isoMinusDays(2),
      event_type: 'media_cache',
      host: 'orphan.test',
      url: 'https://orphan.test/a',
      decision: 'served_200',
      elapsed_ms: 1,
    });
    const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
    // retention prune 0 + orphan 1 = 1
    expect(pruner.tick()).toBe(1);
    const remaining = db.prepare('SELECT host FROM optimization_events').all() as Array<{ host: string }>;
    expect(remaining).toEqual([{ host: 'live.test' }]);
  });

  it('reconcileOrphans 예외는 삼키고 retention 결과만 반환한다', () => {
    const { db, repo } = mkRepo();
    registerHost(db);
    insertAt(repo, isoMinusDays(31)); // 1건은 retention 으로 삭제됨
    // reconcileOrphans 가 throw 하도록 monkey-patch — pruner 가 예외를 삼키는지 확인
    const original = repo.reconcileOrphans.bind(repo);
    repo.reconcileOrphans = () => {
      throw new Error('boom');
    };
    try {
      const pruner = new OptimizationEventsPruner({ repo, now: () => NOW, log: quietLog() });
      expect(() => pruner.tick()).not.toThrow();
    } finally {
      repo.reconcileOrphans = original;
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
