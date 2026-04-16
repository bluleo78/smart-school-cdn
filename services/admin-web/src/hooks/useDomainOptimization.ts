/// 특정 도메인의 최적화 통계를 조회하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchOptimizationStats } from '../api/optimizer';

export function useDomainOptimization(host: string) {
  return useQuery({
    queryKey: ['optimization', 'stats', host],
    queryFn: () => fetchOptimizationStats(host),
    enabled: !!host,
  });
}
