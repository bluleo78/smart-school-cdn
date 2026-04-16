/// 특정 도메인의 최적화 프로파일을 조회하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchOptimizerProfiles } from '../api/optimizer';

export function useOptimizerProfile(host: string) {
  return useQuery({
    queryKey: ['optimizer', 'profile', host],
    queryFn: async () => {
      const { profiles } = await fetchOptimizerProfiles();
      return profiles.find((p) => p.domain === host) ?? null;
    },
    enabled: !!host,
  });
}
