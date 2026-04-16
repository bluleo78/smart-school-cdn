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
        });
      }
    } catch (err) {
      log.warn({ err }, '[stats-collector] Proxy 통계 수집 실패');
    }
  }

  void collect();
  return setInterval(collect, intervalMs);
}
