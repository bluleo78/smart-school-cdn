/// 도메인 요약 통계 조회 훅 — 30초 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomainSummary } from '../api/domains';
import type { DomainSummary } from '../api/domain-types';

export function useDomainSummary() {
  return useQuery<DomainSummary>({
    queryKey: ['domains', 'summary'],
    queryFn: fetchDomainSummary,
    refetchInterval: 30_000,
  });
}
