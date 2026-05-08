import type { FastifyBaseLogger } from 'fastify';
import type { OptimizationEventsRepository } from './db/optimization-events-repo.js';

/**
 * optimization_events retention 기본값 — 30일.
 * proxy가 매 요청마다 push하는 이벤트가 무한 누적되면 SQLite 파일이 GB 단위로 비대해지므로,
 * `dns_metrics_minute`(24h prune)와 동일한 패턴으로 주기 prune 스케줄러를 둔다 (#337).
 */
const DEFAULT_RETENTION_DAYS = 30;
/** 기본 prune 주기 — 1시간. tick 빈도가 높을 필요 없고 SQLite write 부담을 줄인다. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface PrunerOpts {
  repo: OptimizationEventsRepository;
  /** 현재 시각 provider — 테스트에서 주입 */
  now?: () => number;
  /** retention 일수. 미지정 시 env(OPT_EVENTS_RETENTION_DAYS) → 기본 30 */
  retentionDays?: number;
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
}

/**
 * optimization_events 테이블에서 retention 초과 행을 주기적으로 삭제하는 프루너.
 * `OptimizationEventsRepository.prune(beforeIso)`을 호출자가 따로 두지 않으면 영구 누적되므로
 * admin-server 부팅 시 1회 + setInterval로 주기적으로 실행한다.
 */
export class OptimizationEventsPruner {
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(private readonly opts: PrunerOpts) {
    this.now = opts.now ?? (() => Date.now());
    const days = opts.retentionDays ?? readRetentionDaysEnv() ?? DEFAULT_RETENTION_DAYS;
    this.retentionMs = days * 24 * 60 * 60 * 1000;
  }

  /** 1회 prune 실행. 삭제 행 수를 반환 — 테스트/관찰 용. 예외는 로그만 남기고 삼킨다. */
  tick(): number {
    try {
      const beforeIso = new Date(this.now() - this.retentionMs).toISOString();
      const removed = this.opts.repo.prune(beforeIso);
      if (removed > 0) {
        this.opts.log.info(
          { removed, beforeIso },
          '[opt-events-pruner] retention 초과 이벤트 삭제',
        );
      }
      return removed;
    } catch (err) {
      this.opts.log.warn({ err }, '[opt-events-pruner] prune 실패');
      return 0;
    }
  }
}

/** OPT_EVENTS_RETENTION_DAYS 환경변수 파싱 — 양의 정수만 허용, 그 외엔 undefined */
function readRetentionDaysEnv(): number | undefined {
  const raw = process.env.OPT_EVENTS_RETENTION_DAYS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * admin-server 부팅 시 호출 — 즉시 1회 prune 후 setInterval로 주기 prune 시작.
 * dns-metrics-collector의 startDnsMetricsCollector와 동일한 lifecycle 구조를 따른다.
 */
export function startOptimizationEventsPruner(
  opts: PrunerOpts,
  intervalMs = DEFAULT_INTERVAL_MS,
): { stop: () => void; pruner: OptimizationEventsPruner } {
  const pruner = new OptimizationEventsPruner(opts);
  // 부팅 직후 1회 — 장기 다운타임 후 재기동 시 누적분 즉시 정리
  pruner.tick();
  const timer = setInterval(() => void pruner.tick(), intervalMs);
  return { stop: () => clearInterval(timer), pruner };
}
