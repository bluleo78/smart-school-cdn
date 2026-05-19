/// SqliteMaintenanceJob 단위 테스트 (#368).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  runWalCheckpoint,
  runBackup,
  pruneBackups,
  SqliteMaintenanceJob,
} from './sqlite-maintenance.js';

const quietLog = () => ({ warn: () => {}, info: () => {}, error: () => {} });

let tmpDir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'sqlite-maint-'));
  dbPath = path.join(tmpDir, 'admin.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  for (let i = 0; i < 100; i++) db.prepare('INSERT INTO t (v) VALUES (?)').run('x'.repeat(100));
});

afterEach(async () => {
  db.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('runWalCheckpoint', () => {
  it('TRUNCATE 모드로 실행되어 결과 카운트를 반환한다', () => {
    const r = runWalCheckpoint(db, quietLog());
    expect(r.busy).toBe(0);
    expect(typeof r.log_pages).toBe('number');
    expect(typeof r.checkpointed).toBe('number');
  });
});

describe('runBackup', () => {
  it('VACUUM INTO 로 백업 파일을 생성한다', async () => {
    const file = await runBackup({
      db, backupDir: path.join(tmpDir, 'backups'),
      now: new Date('2026-06-01T04:00:00Z'),
      log: quietLog(),
    });
    expect(file).not.toBeNull();
    expect(file).toMatch(/admin-20260601-040000\.db$/);
    const stat = await fs.stat(file!);
    expect(stat.size).toBeGreaterThan(0);
  });
});

describe('pruneBackups', () => {
  it('보관 기간 외 백업 파일만 삭제한다', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    // 오래된 파일 (10일 전 mtime) + 최근 파일 (1일 전 mtime)
    const oldFile = path.join(backupDir, 'admin-20260520-040000.db');
    const newFile = path.join(backupDir, 'admin-20260531-040000.db');
    await fs.writeFile(oldFile, '');
    await fs.writeFile(newFile, '');
    const now = new Date('2026-06-01T04:00:00Z');
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400_000);
    const oneDayAgo  = new Date(now.getTime() -  1 * 86400_000);
    await fs.utimes(oldFile, tenDaysAgo, tenDaysAgo);
    await fs.utimes(newFile, oneDayAgo,  oneDayAgo);

    const removed = await pruneBackups({
      backupDir, retentionDays: 7, now, log: quietLog(),
    });
    expect(removed).toBe(1);
    expect(await fs.stat(oldFile).catch(() => null)).toBeNull();
    expect(await fs.stat(newFile)).toBeDefined();
  });

  it('패턴에 맞지 않는 파일은 건드리지 않는다', async () => {
    const backupDir = path.join(tmpDir, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    const irrelevant = path.join(backupDir, 'README.txt');
    await fs.writeFile(irrelevant, 'hello');
    const ancient = new Date('2020-01-01T00:00:00Z');
    await fs.utimes(irrelevant, ancient, ancient);
    const removed = await pruneBackups({
      backupDir, retentionDays: 1, now: new Date('2026-06-01T00:00:00Z'),
      log: quietLog(),
    });
    expect(removed).toBe(0);
    expect(await fs.stat(irrelevant)).toBeDefined();
  });
});

describe('SqliteMaintenanceJob.tick', () => {
  it('백업 hour 일치 시 백업 + 보관 prune. 같은 날 두 번째 tick 은 백업 skip', async () => {
    const now = new Date('2026-06-01T04:30:00Z'); // 4시대
    const job = new SqliteMaintenanceJob({
      db, dbDir: tmpDir, log: quietLog(),
      now: () => now, backupDir: path.join(tmpDir, 'backups'),
    });
    const r1 = await job.tick();
    expect(r1.checkpoint).toBe(true);
    expect(r1.backup).not.toBeNull();

    // 같은 날 두 번째 tick — backup hour 일치하지만 lastBackupDay 동일하므로 skip
    const r2 = await job.tick();
    expect(r2.backup).toBeNull();
  });

  it('백업 hour 불일치면 checkpoint 만 실행, 백업/prune skip', async () => {
    const now = new Date('2026-06-01T10:00:00Z'); // 10시대
    const job = new SqliteMaintenanceJob({
      db, dbDir: tmpDir, log: quietLog(),
      now: () => now, backupDir: path.join(tmpDir, 'backups'),
    });
    const r = await job.tick();
    expect(r.checkpoint).toBe(true);
    expect(r.backup).toBeNull();
    expect(r.pruned).toBe(0);
  });
});
