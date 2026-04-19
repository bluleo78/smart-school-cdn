/// 도메인 기간별 통계 조회 훅 — 1h/custom(from·to) 지원, 자동 갱신 없음
import { useQuery } from '@tanstack/react-query';
import { fetchDomainStats, type StatsPeriod } from '../api/domains';
import type { DomainStats } from '../api/domain-types';

export function useDomainStats(
  host: string,
  period: StatsPeriod,
  range?: { from: number; to: number },
) {
  return useQuery<DomainStats>({
    queryKey: ['domain', host, 'stats', period, range ?? null],
    queryFn: () => fetchDomainStats(host, period, range),
    enabled: !!host && (period !== 'custom' || !!range),
    refetchInterval: false,
  });
}
