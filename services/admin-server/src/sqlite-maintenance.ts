/// 이슈 #368 — SQLite 정기 유지보수 작업.
///
/// 무엇을:
///   - 1시간마다 wal_checkpoint(TRUNCATE) 실행 → WAL 파일 크기 회수
///   - 매일 한 번 (기본 04시) VACUUM INTO 'backups/admin-YYYYMMDD.db' → 단편화 회수 + 백업 산출물
///   - 보관 기간 외 백업 파일 자동 삭제 (기본 7일)
/// 왜:
///   - 장기 운영 시 WAL/단편화로 DB 파일이 점진 증가 → 부팅 지연 · 디스크 가득 차서 write 실패 사고 예방
///   - VACUUM INTO 산출물 = 즉시 복구 가능한 스냅샷. .shm/.wal 동행 카피보다 운영 단순
///   - pruner(#337/#338)는 행만 삭제 — 공간 회수는 별도. 본 작업이 그 빈공간 회수를 담당
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const DEFAULT_CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000;  // 1시간
const DEFAULT_BACKUP_HOUR              = 4;             // 새벽 4시
const DEFAULT_BACKUP_RETENTION_DAYS    = 7;

export interface SqliteMaintenanceOpts {
  db: Database.Database;
  /** DB 파일 디렉터리 — backup 산출물도 여기 하위 'backups/' 에 저장 */
  dbDir: string;
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
  /** 현재 시각 provider — 테스트에서 주입 */
  now?: () => Date;
  /** 백업 디렉터리 경로 override (기본 dbDir/backups) */
  backupDir?: string;
  /** 백업 보관 기간 (일) — 기본 7 */
  retentionDays?: number;
}

/** WAL checkpoint(TRUNCATE) 1회 실행. 결과 카운트 반환. */
export function runWalCheckpoint(
  db: Database.Database,
  log: Pick<FastifyBaseLogger, 'warn' | 'info'>,
): { busy: number; log_pages: number; checkpointed: number } {
  // PRAGMA wal_checkpoint(TRUNCATE) 반환: [busy, log_pages, checkpointed]
  const row = db.pragma('wal_checkpoint(TRUNCATE)') as Array<Record<string, number>>;
  // better-sqlite3 의 PRAGMA wal_checkpoint 반환은 {busy, log, checkpointed} key 객체 1개의 배열
  const r = row[0] ?? { busy: 0, log: 0, checkpointed: 0 };
  const out = { busy: r.busy ?? 0, log_pages: r.log ?? 0, checkpointed: r.checkpointed ?? 0 };
  if (out.busy > 0) {
    log.warn({ ...out }, '[sqlite-maintenance] WAL checkpoint busy — 다른 writer 대기 중');
  } else {
    log.info({ ...out }, '[sqlite-maintenance] WAL checkpoint 완료');
  }
  return out;
}

/** VACUUM INTO 백업 1회 실행. 결과 파일 경로 반환. */
export async function runBackup(
  opts: { db: Database.Database; backupDir: string; now: Date; log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'> },
): Promise<string | null> {
  const { db, backupDir, now, log } = opts;
  try {
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
    const file = path.join(backupDir, `admin-${stamp}.db`);
    // VACUUM INTO 는 SQL injection 가능성을 차단하기 위해 직접 quote — 백업 파일명은 내부 생성이라 안전.
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const stat = await fs.stat(file);
    log.info({ file, size_bytes: stat.size }, '[sqlite-maintenance] VACUUM INTO 백업 완료');
    return file;
  } catch (err) {
    log.error({ err }, '[sqlite-maintenance] VACUUM INTO 실패');
    return null;
  }
}

/** 보관 기간 외 백업 파일 삭제. 삭제된 개수 반환. */
export async function pruneBackups(
  opts: { backupDir: string; retentionDays: number; now: Date; log: Pick<FastifyBaseLogger, 'warn' | 'info'> },
): Promise<number> {
  const { backupDir, retentionDays, now, log } = opts;
  try {
    const cutoffMs = now.getTime() - retentionDays * 86400_000;
    const files = await fs.readdir(backupDir).catch(() => [] as string[]);
    let removed = 0;
    for (const name of files) {
      if (!/^admin-\d{8}-\d{6}\.db$/.test(name)) continue; // VACUUM INTO 산출물 형식만 정리
      const full = path.join(backupDir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(full).catch(() => {});
        removed += 1;
      }
    }
    if (removed > 0) log.info({ removed, retentionDays }, '[sqlite-maintenance] 오래된 백업 정리');
    return removed;
  } catch (err) {
    log.warn({ err }, '[sqlite-maintenance] 백업 정리 실패');
    return 0;
  }
}

export class SqliteMaintenanceJob {
  private readonly now: () => Date;
  private readonly backupHour: number;
  private readonly retentionDays: number;
  private readonly backupDir: string;
  private lastBackupDay: string | null = null;
  constructor(private readonly opts: SqliteMaintenanceOpts) {
    this.now = opts.now ?? (() => new Date());
    this.backupHour = Number(process.env.MAINTENANCE_HOUR) >= 0 && Number(process.env.MAINTENANCE_HOUR) <= 23
      ? Number(process.env.MAINTENANCE_HOUR)
      : DEFAULT_BACKUP_HOUR;
    this.retentionDays = opts.retentionDays
      ?? (Number(process.env.BACKUP_RETENTION_DAYS) > 0 ? Number(process.env.BACKUP_RETENTION_DAYS) : DEFAULT_BACKUP_RETENTION_DAYS);
    this.backupDir = opts.backupDir ?? path.join(opts.dbDir, 'backups');
  }

  /** 1회 tick — checkpoint 항상 실행 + 백업 hour 일치 시 백업 + 보관 prune. */
  async tick(): Promise<{ checkpoint: boolean; backup: string | null; pruned: number }> {
    runWalCheckpoint(this.opts.db, this.opts.log);
    const now = this.now();
    const dayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    let backup: string | null = null;
    let pruned = 0;
    if (now.getUTCHours() === this.backupHour && this.lastBackupDay !== dayKey) {
      backup = await runBackup({ db: this.opts.db, backupDir: this.backupDir, now, log: this.opts.log });
      if (backup) {
        this.lastBackupDay = dayKey;
        pruned = await pruneBackups({
          backupDir: this.backupDir, retentionDays: this.retentionDays, now, log: this.opts.log,
        });
      }
    }
    return { checkpoint: true, backup, pruned };
  }
}

/** 부팅 시 호출 — 즉시 1회 + 1시간 주기. */
export function startSqliteMaintenance(
  opts: SqliteMaintenanceOpts,
  intervalMs: number = DEFAULT_CHECKPOINT_INTERVAL_MS,
): { stop: () => void; job: SqliteMaintenanceJob } {
  const job = new SqliteMaintenanceJob(opts);
  job.tick().catch(() => {});
  const timer = setInterval(() => void job.tick().catch(() => {}), intervalMs);
  return { stop: () => clearInterval(timer), job };
}
