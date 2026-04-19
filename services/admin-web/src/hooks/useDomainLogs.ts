/// 도메인 요청 로그 조회 훅 — 기간/상태/캐시/검색 필터 + 동적 자동 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchDomainLogs, type DomainLogsOptions } from '../api/domains';
import type { DomainLog } from '../api/domain-types';

export function useDomainLogs(
  host: string,
  options: DomainLogsOptions = {},
  refetchIntervalMs: number | false = false,
) {
  return useQuery<DomainLog[]>({
    queryKey: ['domain', host, 'logs', options],
    queryFn: () => fetchDomainLogs(host, options),
    enabled:
      !!host &&
      (options.period !== 'custom' ||
        (options.from !== undefined && options.to !== undefined)),
    refetchInterval: refetchIntervalMs === 0 ? false : refetchIntervalMs,
  });
}
