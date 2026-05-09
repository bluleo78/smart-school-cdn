/// 도메인 추가 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDomain } from '../api/domains';

export function useAddDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ host, origin }: { host: string; origin: string }) =>
      addDomain(host, origin),
    onSuccess: () => {
      // 도메인 추가는 admin-server에서 tlsClient.syncDomains + dnsClient.syncDomains 를 호출하여
      // TLS 인증서·DNS 레코드 목록이 즉시 갱신된다. 따라서 ['domains']뿐 아니라
      // TLS/DNS 페이지·Dashboard 인기 콘텐츠/통계 쿼리도 모두 무효화하여
      // 다른 페이지에 stale 상태(누락된 신규 도메인)가 보이지 않도록 한다. (#371, delete와 대칭 #334)
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['tls'] });
      void queryClient.invalidateQueries({ queryKey: ['dns'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
    },
  });
}
