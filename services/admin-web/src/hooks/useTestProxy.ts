/// 프록시 테스트 useMutation 훅 — 성공 시 프록시/캐시 쿼리 무효화
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { testProxy } from '../api/proxy';

export function useTestProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, path }: { domain: string; path: string }) =>
      testProxy(domain, path),
    onSuccess: () => {
      // 테스트 요청이 프록시를 경유했으므로 관련 쿼리 즉시 갱신
      queryClient.invalidateQueries({ queryKey: ['proxy', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['proxy', 'requests'] });
      queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
    },
  });
}
