/// 최적화 절감 통계를 조회하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchOptimizationStats } from '../api/optimizer';

export function useOptimizationStats() {
  return useQuery({
    queryKey: ['optimizer', 'stats'],
    queryFn: () => fetchOptimizationStats(),
    refetchInterval: 30_000,
  });
}
