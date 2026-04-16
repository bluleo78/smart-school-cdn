/// 도메인 강제 동기화 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncDomain } from '../api/tls';
import { toast } from 'sonner';

export function useSyncDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => syncDomain(host),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['domain'] });
      const ok = result.proxy && result.tls && result.dns;
      if (ok) toast.success('모든 서비스 동기화 완료');
      else toast.warning('일부 서비스 동기화 실패');
    },
    onError: () => toast.error('동기화에 실패했습니다.'),
  });
}
