/// 최근 요청 로그를 5초 간격으로 폴링하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchProxyRequests } from '../api/proxy';

export function useProxyRequests() {
  return useQuery({
    queryKey: ['proxy', 'requests'],
    queryFn: fetchProxyRequests,
    refetchInterval: 5000,
  });
}
