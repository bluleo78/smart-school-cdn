/// 최적화 프로파일을 수정하는 TanStack Query Mutation 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateOptimizerProfile, type OptimizerProfile } from '../api/optimizer';

export function useUpdateOptimizerProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: OptimizerProfile) => updateOptimizerProfile(profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['optimizer'] });
      toast.success('저장되었습니다.');
    },
    onError: () => {
      toast.error('저장에 실패했습니다.');
    },
  });
}
