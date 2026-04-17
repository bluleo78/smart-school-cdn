import type Database from 'better-sqlite3';

/** DNS 메트릭 분 단위 시계열 스키마 — bucket_ts는 해당 분의 시작 시각(epoch ms) */
export const DNS_METRICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS dns_metrics_minute (
    bucket_ts  INTEGER PRIMARY KEY,
    total      INTEGER NOT NULL,
    matched    INTEGER NOT NULL,
    nxdomain   INTEGER NOT NULL,
    forwarded  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dns_metrics_minute_ts ON dns_metrics_minute(bucket_ts);
`;

export interface MetricDelta {
  total: number;
  matched: number;
  nxdomain: number;
  forwarded: number;
}

export interface MetricBucket extends MetricDelta {
  bucket_ts: number;
}

export class DnsMetricsRepository {
  constructor(private readonly db: Database.Database) {}

  /** bucket_ts에 델타를 가산 — 없으면 insert, 있으면 UPDATE로 누적 */
  upsertDelta(bucketTs: number, d: MetricDelta): void {
    this.db.prepare(`
      INSERT INTO dns_metrics_minute (bucket_ts, total, matched, nxdomain, forwarded)
      VALUES (@bucket_ts, @total, @matched, @nxdomain, @forwarded)
      ON CONFLICT(bucket_ts) DO UPDATE SET
        total     = total     + excluded.total,
        matched   = matched   + excluded.matched,
        nxdomain  = nxdomain  + excluded.nxdomain,
        forwarded = forwarded + excluded.forwarded
    `).run({
      bucket_ts: bucketTs,
      total: d.total, matched: d.matched, nxdomain: d.nxdomain, forwarded: d.forwarded,
    });
  }

  /** [fromMs, toMs] 범위(양 끝 포함)의 버킷을 시간 오름차순으로 반환 */
  range(fromMs: number, toMs: number): MetricBucket[] {
    return this.db.prepare(`
      SELECT bucket_ts, total, matched, nxdomain, forwarded
      FROM dns_metrics_minute
      WHERE bucket_ts BETWEEN ? AND ?
      ORDER BY bucket_ts ASC
    `).all(fromMs, toMs) as MetricBucket[];
  }

  /** 기준 시각 이전 행 삭제. 삭제된 행 수 반환 */
  prune(beforeMs: number): number {
    const info = this.db.prepare(`DELETE FROM dns_metrics_minute WHERE bucket_ts < ?`).run(beforeMs);
    return info.changes;
  }
}
