/// 캐시 퍼지 useMutation 훅 — 성공 시 stats/popular 쿼리 무효화
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { purgeCache, type PurgeRequest } from '../api/cache';

export function usePurgeCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PurgeRequest) => purgeCache(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
    },
  });
}
