/// 캐시 통계를 5초 간격으로 폴링하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchCacheStats } from '../api/cache';

export function useCacheStats() {
  return useQuery({
    queryKey: ['cache', 'stats'],
    queryFn: fetchCacheStats,
    refetchInterval: 5000,
  });
}
