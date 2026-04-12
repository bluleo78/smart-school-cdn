/// 도메인 추가 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDomain } from '../api/domains';

export function useAddDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ host, origin }: { host: string; origin: string }) =>
      addDomain(host, origin),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
  });
}
