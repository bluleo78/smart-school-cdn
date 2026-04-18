import { useQuery } from '@tanstack/react-query';
import { fetchCacheStats, type CacheStats } from '../api/cache';

/** 캐시 통계 집계 조회 — 10초 주기 자동 갱신 */
export function useCacheStats() {
  return useQuery<CacheStats>({
    queryKey: ['cache', 'stats'],
    queryFn: fetchCacheStats,
    refetchInterval: 10_000,
  });
}
