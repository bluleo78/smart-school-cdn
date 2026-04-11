/// 인기 콘텐츠를 10초 간격으로 폴링하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchCachePopular } from '../api/cache';

export function useCachePopular() {
  return useQuery({
    queryKey: ['cache', 'popular'],
    queryFn: fetchCachePopular,
    refetchInterval: 10000,
  });
}
