/// 도메인 Top URL 훅 — 기간 내 상위 N 경로 조회
import { useQuery } from '@tanstack/react-query';
import { fetchDomainTopUrls, type StatsPeriod } from '../api/domains';
import type { DomainTopUrl } from '../api/domain-types';

export function useDomainTopUrls(
  host: string,
  period: StatsPeriod,
  range?: { from: number; to: number },
  refetchIntervalMs: number | false = false,
) {
  return useQuery<DomainTopUrl[]>({
    queryKey: ['domain', host, 'top-urls', period, range ?? null],
    queryFn: () => fetchDomainTopUrls(host, period, range),
    enabled: !!host && (period !== 'custom' || !!range),
    refetchInterval: refetchIntervalMs === 0 ? false : refetchIntervalMs,
  });
}
