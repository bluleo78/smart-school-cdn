import type { FastifyBaseLogger } from 'fastify';
import type { DnsMetricsRepository, MetricDelta } from './db/dns-metrics-repo.js';
import type { StatsResponse } from './grpc/dns_client.js';

const BUCKET_MS = 60_000;                 // 1분
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24시간

export interface CollectorOpts {
  /** dns-service 스탯 조회 함수 — 테스트에서 mock */
  getStats: () => Promise<StatsResponse>;
  repo: DnsMetricsRepository;
  /** 현재 시각 provider — 테스트에서 주입 */
  now?: () => number;
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
}

/** 5초마다 dns-service에서 누적 스냅샷을 읽어 델타를 SQLite에 적재 */
export class DnsMetricsCollector {
  private lastSnapshot: MetricDelta | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: CollectorOpts) {
    this.now = opts.now ?? (() => Date.now());
  }

  async tick(): Promise<void> {
    let snap: StatsResponse;
    try {
      snap = await this.opts.getStats();
    } catch (err) {
      this.opts.log.warn({ err }, '[dns-collector] dns-service 스냅샷 실패');
      return;
    }

    // shared.ts의 longs: String 매핑 — 모든 uint64 필드는 string으로 도착함
    const current: MetricDelta = {
      total:     Number(snap.total_queries),
      matched:   Number(snap.matched),
      nxdomain:  Number(snap.nxdomain),
      forwarded: Number(snap.forwarded),
    };

    if (this.lastSnapshot === null) {
      this.lastSnapshot = current;
      this.opts.repo.prune(this.now() - RETENTION_MS);
      return;
    }

    const delta = this.computeDelta(this.lastSnapshot, current);
    if (delta.total > 0 || delta.matched > 0 || delta.nxdomain > 0 || delta.forwarded > 0) {
      const bucketTs = Math.floor(this.now() / BUCKET_MS) * BUCKET_MS;
      this.opts.repo.upsertDelta(bucketTs, delta);
    }
    this.lastSnapshot = current;
    this.opts.repo.prune(this.now() - RETENTION_MS);
  }

  /** 현재값이 이전값보다 작으면 (dns-service 재시작) delta = current */
  private computeDelta(prev: MetricDelta, curr: MetricDelta): MetricDelta {
    if (curr.total < prev.total) {
      return { ...curr };
    }
    return {
      total:     curr.total     - prev.total,
      matched:   curr.matched   - prev.matched,
      nxdomain:  curr.nxdomain  - prev.nxdomain,
      forwarded: curr.forwarded - prev.forwarded,
    };
  }
}

/** admin-server 부팅 시 호출 — setInterval 기반 자동 폴링 시작 */
export function startDnsMetricsCollector(
  opts: CollectorOpts,
  intervalMs = 5_000,
): { stop: () => void; collector: DnsMetricsCollector } {
  const collector = new DnsMetricsCollector(opts);
  const timer = setInterval(() => void collector.tick(), intervalMs);
  void collector.tick(); // 즉시 1회
  return { stop: () => clearInterval(timer), collector };
}
