/// TLS React Query 훅
import { useQuery } from '@tanstack/react-query';
import { fetchCertificates, type CertInfo } from '../api/tls';

/** 발급된 인증서 목록 — 30초 간격 갱신 */
export function useCertificates() {
  return useQuery<CertInfo[]>({
    queryKey: ['tls', 'certificates'],
    queryFn: fetchCertificates,
    refetchInterval: 30_000,
    initialData: [],
  });
}
