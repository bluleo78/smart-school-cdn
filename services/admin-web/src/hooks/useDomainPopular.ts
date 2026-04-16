/// 특정 도메인의 인기 콘텐츠를 30초 간격으로 폴링하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchCachePopular } from '../api/cache';

export function useDomainPopular(host: string) {
  return useQuery({
    queryKey: ['cache', 'popular', host],
    queryFn: () => fetchCachePopular(host),
    enabled: !!host,
    refetchInterval: 30_000,
  });
}
