/// 프록시 상태를 5초 간격으로 폴링하는 TanStack Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchProxyStatus } from '../api/proxy';

export function useProxyStatus() {
  return useQuery({
    queryKey: ['proxy', 'status'],
    queryFn: fetchProxyStatus,
    refetchInterval: 5000,
  });
}
