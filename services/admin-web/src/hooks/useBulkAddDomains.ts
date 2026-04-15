/// 도메인 일괄 추가 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { bulkAddDomains } from '../api/domains';

interface BulkAddVars {
  domains: Array<{ host: string; origin: string }>;
}

export function useBulkAddDomains() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domains }: BulkAddVars) => bulkAddDomains(domains),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      const msg =
        data.failed.length > 0
          ? `${data.success}건 추가, ${data.failed.length}건 실패`
          : `${data.success}건이 추가되었습니다.`;
      if (data.failed.length > 0) {
        toast.warning(msg);
      } else {
        toast.success(msg);
      }
    },
    onError: () => {
      toast.error('도메인 일괄 추가에 실패했습니다.');
    },
  });
}
