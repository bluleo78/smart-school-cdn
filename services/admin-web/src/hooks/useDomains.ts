/// 도메인 목록 조회 훅 — 30초 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomains, type Domain } from '../api/domains';

export function useDomains() {
  return useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    refetchInterval: 30_000,
  });
}
