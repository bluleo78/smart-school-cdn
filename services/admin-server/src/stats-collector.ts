import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import type { DomainStatsRepository } from './db/domain-stats-repo.js';

interface ProxyStat {
  host: string;
  requests: number;
  cache_hits: number;
  cache_misses: number;
  bandwidth: number;
  avg_response_time: number;
  // Phase 12 신규 — Proxy가 아직 전송하지 않는 경우 0으로 폴백
  l1_hits?: number;
  l2_hits?: number;
  bypass_method?: number;
  bypass_nocache?: number;
  bypass_size?: number;
  bypass_other?: number;
}

/** Proxy에서 통계를 가져와 DB에 저장하는 폴링 타이머 */
export function startStatsCollector(
  proxyAdminUrl: string,
  statsRepo: DomainStatsRepository,
  log: FastifyBaseLogger,
  intervalMs = 60_000,
): NodeJS.Timeout {
  async function collect() {
    try {
      const { data } = await axios.get<ProxyStat[]>(`${proxyAdminUrl}/stats`);
      const now = Math.floor(Date.now() / 1000);
      for (const stat of data) {
        if (stat.requests === 0) continue;
        statsRepo.insert({
          host: stat.host,
          timestamp: now,
          requests: stat.requests,
          cache_hits: stat.cache_hits,
          cache_misses: stat.cache_misses,
          bandwidth: stat.bandwidth,
          avg_response_time: stat.avg_response_time,
          l1_hits: stat.l1_hits ?? 0,
          l2_hits: stat.l2_hits ?? 0,
          bypass_method: stat.bypass_method ?? 0,
          bypass_nocache: stat.bypass_nocache ?? 0,
          bypass_size: stat.bypass_size ?? 0,
          bypass_other: stat.bypass_other ?? 0,
        });
      }
    } catch (err) {
      log.warn({ err }, '[stats-collector] Proxy 통계 수집 실패');
    }
  }

  void collect();
  return setInterval(collect, intervalMs);
}
