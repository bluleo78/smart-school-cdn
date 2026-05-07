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

      // (#197) added/skipped/failed 분리 안내 — 기존 host 는 덮어쓰지 않고 skipped 로 분류된다.
      // 사용자에게 신규 추가 / 이미 존재 / 실패 건수를 명시적으로 보여주어 origin 무결성을 인지하도록 한다.
      const parts: string[] = [];
      parts.push(`${data.added}건 추가`);
      if (data.skipped.length > 0) {
        parts.push(`${data.skipped.length}건은 이미 존재함 (덮어쓰기 안 됨)`);
      }
      if (data.failed.length > 0) {
        parts.push(`${data.failed.length}건 실패`);
      }
      const msg = parts.join(', ');

      // skipped/failed 가 있으면 어느 host 가 어떤 이유인지 구체적으로 description 에 노출 — CSV 대량 입력 시 추적 가능.
      const detailLines: string[] = [];
      if (data.skipped.length > 0) {
        const list = data.skipped
          .slice(0, 5)
          .map((s) => `${s.host} → ${s.existingOrigin}`)
          .join('\n');
        detailLines.push(
          `이미 존재: \n${list}${data.skipped.length > 5 ? `\n…외 ${data.skipped.length - 5}건` : ''}`,
        );
      }
      if (data.failed.length > 0) {
        const list = data.failed
          .slice(0, 5)
          .map((f) => `${f.host}: ${f.error}`)
          .join('\n');
        detailLines.push(
          `실패: \n${list}${data.failed.length > 5 ? `\n…외 ${data.failed.length - 5}건` : ''}`,
        );
      }
      const description = detailLines.length > 0 ? detailLines.join('\n\n') : undefined;

      if (data.failed.length > 0) {
        toast.error(msg, { description });
      } else if (data.skipped.length > 0) {
        toast.warning(msg, { description });
      } else {
        toast.success(msg);
      }
    },
    onError: () => {
      toast.error('도메인 일괄 추가에 실패했습니다.');
    },
  });
}
