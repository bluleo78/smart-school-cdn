import type { FastifyBaseLogger } from 'fastify';
import type { DomainStatsRepository } from './db/domain-stats-repo.js';

/**
 * domain_stats retention 기본값 — 30일.
 * stats-collector가 매 분 INSERT/UPSERT를 수행하지만 cleanup 호출자가 없어
 * 영구 누적되던 문제(#338)를 해결하기 위해 optimization-events-pruner와 동일한
 * 부팅 시 1회 + 주기 tick 패턴으로 prune 스케줄러를 둔다.
 */
const DEFAULT_RETENTION_DAYS = 30;
/** 기본 prune 주기 — 1시간. tick 빈도가 높을 필요 없고 SQLite write 부담을 줄인다. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface DomainStatsPrunerOpts {
  repo: DomainStatsRepository;
  /** 현재 시각 provider — 테스트에서 주입 */
  now?: () => number;
  /** retention 일수. 미지정 시 env(DOMAIN_STATS_RETENTION_DAYS) → 기본 30 */
  retentionDays?: number;
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
}

/**
 * domain_stats 테이블에서 retention 초과 행을 주기적으로 삭제하는 프루너.
 * `DomainStatsRepository.cleanup()`이 정의되어 있지만 호출자가 없어 무한 누적되던
 * 회귀(#338)를 차단하기 위해 admin-server 부팅 시 1회 + setInterval 주기 실행.
 */
export class DomainStatsPruner {
  private readonly now: () => number;
  private readonly retentionSec: number;

  constructor(private readonly opts: DomainStatsPrunerOpts) {
    this.now = opts.now ?? (() => Date.now());
    const days = opts.retentionDays ?? readRetentionDaysEnv() ?? DEFAULT_RETENTION_DAYS;
    // domain_stats.timestamp는 Unix 초 단위 버킷이므로 retention 도 초로 환산
    this.retentionSec = days * 24 * 60 * 60;
  }

  /** 1회 prune 실행. 삭제 행 수를 반환 — 테스트/관찰 용. 예외는 로그만 남기고 삼킨다. */
  tick(): number {
    try {
      const cutoffSec = Math.floor(this.now() / 1000) - this.retentionSec;
      const removed = this.opts.repo.pruneBefore(cutoffSec);
      if (removed > 0) {
        this.opts.log.info(
          { removed, cutoffSec },
          '[domain-stats-pruner] retention 초과 통계 삭제',
        );
      }
      return removed;
    } catch (err) {
      this.opts.log.warn({ err }, '[domain-stats-pruner] prune 실패');
      return 0;
    }
  }
}

/** DOMAIN_STATS_RETENTION_DAYS 환경변수 파싱 — 양의 정수만 허용, 그 외엔 undefined */
function readRetentionDaysEnv(): number | undefined {
  const raw = process.env.DOMAIN_STATS_RETENTION_DAYS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * admin-server 부팅 시 호출 — 즉시 1회 prune 후 setInterval로 주기 prune 시작.
 * optimization-events-pruner의 startOptimizationEventsPruner와 동일한 lifecycle 구조.
 */
export function startDomainStatsPruner(
  opts: DomainStatsPrunerOpts,
  intervalMs = DEFAULT_INTERVAL_MS,
): { stop: () => void; pruner: DomainStatsPruner } {
  const pruner = new DomainStatsPruner(opts);
  // 부팅 직후 1회 — 장기 다운타임 후 재기동 시 누적분 즉시 정리
  pruner.tick();
  const timer = setInterval(() => void pruner.tick(), intervalMs);
  return { stop: () => clearInterval(timer), pruner };
}
