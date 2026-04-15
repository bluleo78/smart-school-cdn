/// 도메인 일괄 삭제 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { bulkDeleteDomains } from '../api/domains';

export function useBulkDeleteDomains() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hosts: string[]) => bulkDeleteDomains(hosts),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      toast.success(`${data.deleted}건이 삭제되었습니다.`);
    },
    onError: () => {
      toast.error('도메인 일괄 삭제에 실패했습니다.');
    },
  });
}
