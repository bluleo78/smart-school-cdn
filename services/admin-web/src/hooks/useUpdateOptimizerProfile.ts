/// 최적화 프로파일을 수정하는 TanStack Query Mutation 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateOptimizerProfile, type OptimizerProfile } from '../api/optimizer';

/** Axios 에러 응답에서 서버 메시지를 추출한다. 없으면 undefined 반환. */
function extractServerMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { message?: string } } }).response;
    return res?.data?.message;
  }
  return undefined;
}

export function useUpdateOptimizerProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: OptimizerProfile) => updateOptimizerProfile(profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['optimizer'] });
      toast.success('저장되었습니다.');
    },
    // 서버 검증 오류 메시지(예: "body/quality must be >= 1")가 있으면 표시하여
    // 사용자가 무엇이 잘못됐는지 알 수 있도록 한다
    onError: (err) => {
      const serverMsg = extractServerMessage(err);
      toast.error(serverMsg ?? '저장에 실패했습니다.');
    },
  });
}
