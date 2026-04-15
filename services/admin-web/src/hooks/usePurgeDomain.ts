/// 도메인 캐시 퍼지 뮤테이션 훅
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { purgeDomain } from '../api/domains';

export function usePurgeDomain() {
  return useMutation({
    mutationFn: (host: string) => purgeDomain(host),
    onSuccess: () => {
      toast.success('캐시가 퍼지되었습니다.');
    },
    onError: () => {
      toast.error('캐시 퍼지에 실패했습니다.');
    },
  });
}
