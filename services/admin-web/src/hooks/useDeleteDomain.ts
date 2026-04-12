/// 도메인 삭제 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteDomain } from '../api/domains';

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => deleteDomain(host),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}
