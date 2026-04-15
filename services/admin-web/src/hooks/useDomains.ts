/// 도메인 목록 조회 훅 — 30초 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomains, type Domain } from '../api/domains';
import type { DomainsFilter } from '../api/domain-types';

export function useDomains(filter?: DomainsFilter) {
  return useQuery<Domain[]>({
    queryKey: ['domains', filter],
    queryFn: () => fetchDomains(filter),
    refetchInterval: 30_000,
  });
}
