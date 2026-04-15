/// 도메인 편집 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateDomain, type Domain } from '../api/domains';

interface UpdateDomainVars {
  host: string;
  body: Partial<Pick<Domain, 'origin' | 'enabled' | 'description'>>;
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ host, body }: UpdateDomainVars) => updateDomain(host, body),
    onSuccess: (_data, { host }) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['domain', host] });
      toast.success('도메인이 수정되었습니다.');
    },
    onError: () => {
      toast.error('도메인 수정에 실패했습니다.');
    },
  });
}
