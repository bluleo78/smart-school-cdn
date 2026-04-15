/// 도메인 요청 로그 조회 훅 — 30초 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomainLogs } from '../api/domains';
import type { DomainLog } from '../api/domain-types';

interface DomainLogsOptions {
  limit?: number;
  offset?: number;
}

export function useDomainLogs(host: string, options?: DomainLogsOptions) {
  return useQuery<DomainLog[]>({
    queryKey: ['domain', host, 'logs', options],
    queryFn: () => fetchDomainLogs(host, options),
    enabled: !!host,
    refetchInterval: 30_000,
  });
}
