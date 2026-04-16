/// 도메인별 TLS 인증서 상태를 조회하는 훅 — 1분 간격 갱신
import { useQuery } from '@tanstack/react-query';
import { fetchCertificates } from '../api/tls';

export function useDomainTls(host: string) {
  return useQuery({
    queryKey: ['tls', 'cert', host],
    queryFn: async () => {
      const certs = await fetchCertificates();
      return certs.find(c => c.domain === host) ?? null;
    },
    enabled: !!host,
    refetchInterval: 60_000,
  });
}
