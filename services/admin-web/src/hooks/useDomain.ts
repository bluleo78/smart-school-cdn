/// 단일 도메인 조회 훅
import { useQuery } from '@tanstack/react-query';
import { fetchDomain, type Domain } from '../api/domains';

export function useDomain(host: string) {
  return useQuery<Domain>({
    queryKey: ['domain', host],
    queryFn: () => fetchDomain(host),
    enabled: !!host,
  });
}
