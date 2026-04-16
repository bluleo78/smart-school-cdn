/// TLS 인증서 갱신 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renewCert } from '../api/tls';
import { toast } from 'sonner';

export function useTlsRenew() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => renewCert(host),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tls'] });
      toast.success('TLS 인증서가 갱신되었습니다.');
    },
    onError: () => toast.error('TLS 갱신에 실패했습니다.'),
  });
}
