/// 도메인 삭제 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteDomain } from '../api/domains';

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => deleteDomain(host),
    onSuccess: () => {
      // 도메인 삭제는 admin-server에서 TLS 인증서/DNS 레코드/캐시 객체 연쇄 정리/orphan 처리를 유발한다.
      // 따라서 ['domains']뿐 아니라 TLS/DNS 페이지·Dashboard 인기 콘텐츠 쿼리도 모두 무효화하여
      // 다른 페이지에 stale 상태(삭제된 도메인 잔존)가 보이지 않도록 한다. (#334)
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['tls'] });
      void queryClient.invalidateQueries({ queryKey: ['dns'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
    },
  });
}
