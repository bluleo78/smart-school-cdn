/// 도메인 활성/비활성 토글 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toggleDomain } from '../api/domains';

export function useToggleDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => toggleDomain(host),
    onSuccess: (data, host) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['domain', host] });
      const label = data.enabled ? '활성화' : '비활성화';
      toast.success(`도메인이 ${label}되었습니다.`);
    },
    onError: () => {
      toast.error('도메인 토글에 실패했습니다.');
    },
  });
}
