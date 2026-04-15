/// 도메인 기간별 통계 조회 훅 — 60초 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomainStats } from '../api/domains';
import type { DomainStats } from '../api/domain-types';

export function useDomainStats(host: string, period: '24h' | '7d' | '30d') {
  return useQuery<DomainStats>({
    queryKey: ['domain', host, 'stats', period],
    queryFn: () => fetchDomainStats(host, period),
    enabled: !!host,
    refetchInterval: 60_000,
  });
}
