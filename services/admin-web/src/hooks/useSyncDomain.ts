/// 도메인 강제 동기화 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncDomain } from '../api/tls';
import { toast } from 'sonner';

export function useSyncDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => syncDomain(host),
    onSuccess: (result, host) => {
      // 수동 동기화는 proxy/tls/dns 세 서비스에 도메인을 강제 재반영한다.
      // 따라서 detail 트리뿐 아니라 도메인 목록(TLS 상태 컬럼)·TLS 인증서·DNS 레코드 쿼리도
      // 함께 무효화하여 다른 페이지·다른 탭이 30초 폴링 전까지 stale 상태로 남는 것을 방지한다. (#373)
      void queryClient.invalidateQueries({ queryKey: ['domain', host] });
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['tls'] });
      void queryClient.invalidateQueries({ queryKey: ['dns'] });
      const ok = result.proxy && result.tls && result.dns;
      if (ok) toast.success('모든 서비스가 동기화되었습니다.');
      else toast.warning('일부 서비스 동기화 실패');
    },
    onError: () => toast.error('동기화에 실패했습니다.'),
  });
}
