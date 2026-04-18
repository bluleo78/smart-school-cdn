/// 단일 도메인 요약 통계 훅 — L1/Edge/Bypass 비율 포함 (Overview 카드용)
import { useQuery } from '@tanstack/react-query';
import { fetchDomainHostSummary } from '../api/domains';
import type { DomainHostSummary } from '../api/domain-types';

/** 특정 host의 오늘 L1/Edge/Bypass 비율을 10초 주기로 갱신한다. */
export function useDomainHostSummary(host: string) {
  return useQuery<DomainHostSummary>({
    queryKey: ['domain', host, 'host-summary'],
    queryFn: () => fetchDomainHostSummary(host),
    enabled: !!host,
    refetchInterval: 10_000,
  });
}
