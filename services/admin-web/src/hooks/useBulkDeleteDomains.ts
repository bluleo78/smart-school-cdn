/// 도메인 일괄 삭제 뮤테이션 훅
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { bulkDeleteDomains } from '../api/domains';

/**
 * 부분 실패 안내 시 누락된 호스트를 토스트에 펼쳐 표시할 최대 개수.
 * 너무 길어지면 가독성을 해치므로 앞부분만 보여주고 나머지는 "외 K건"으로 줄여 표시한다.
 */
const MISSING_PREVIEW_LIMIT = 3;

/** missing 배열을 사용자에게 보여줄 짧은 문자열로 변환 (예: 'a.test, b.test 외 2건') */
function formatMissing(missing: string[]): string {
  if (missing.length <= MISSING_PREVIEW_LIMIT) return missing.join(', ');
  const head = missing.slice(0, MISSING_PREVIEW_LIMIT).join(', ');
  return `${head} 외 ${missing.length - MISSING_PREVIEW_LIMIT}건`;
}

/**
 * 도메인 일괄 삭제 훅 (#212)
 * - 응답 shape: { deleted, requested, missing }
 * - missing 이 비어있고 deleted === requested 이면 success 토스트
 * - missing 이 비어있지 않거나 deleted < requested 이면 warning 토스트로 분리 안내
 *   (다른 세션의 선삭제/정규화 차이로 인해 일부만 삭제된 부분 실패 케이스)
 */
export function useBulkDeleteDomains() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hosts: string[]) => bulkDeleteDomains(hosts),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      const { deleted, requested, missing } = data;
      // 부분 실패 분기 — 요청 수와 실제 삭제 수가 다르거나 missing 목록이 있으면 warning.
      if (missing.length > 0 || deleted < requested) {
        const detail = missing.length > 0 ? ` 누락: ${formatMissing(missing)}` : '';
        toast.warning(`요청 ${requested}건 중 ${deleted}건만 삭제되었습니다.${detail}`);
        return;
      }
      toast.success(`${deleted}건이 삭제되었습니다.`);
    },
    onError: () => {
      toast.error('도메인 일괄 삭제에 실패했습니다.');
    },
  });
}
