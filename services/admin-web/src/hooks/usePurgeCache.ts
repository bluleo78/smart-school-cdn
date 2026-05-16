/// 캐시 퍼지 useMutation 훅 — 성공 시 관련 쿼리 트리를 모두 무효화한다.
/// usePurgeDomain(#333)·useTestProxy(#335)와 invalidate 패턴을 정렬해
/// Dashboard ByDomainTable(['domains','summary'] 30s 폴링)과
/// CacheHitRateChart(['cache','series'] 10s 폴링)가 퍼지 직후 stale 값을
/// 그대로 보이는 비대칭 문제를 해소한다 (#419).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { purgeCache, type PurgeRequest } from '../api/cache';

export function usePurgeCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PurgeRequest) => purgeCache(req),
    /**
     * 퍼지 성공 시 stale 캐시를 무효화한다 (#419).
     * - ['cache','stats']    : 전역 캐시 stats — KPI 카드(요청/HIT/MISS/BYPASS) 즉시 반영
     * - ['cache','popular']  : 인기 URL Top — 퍼지된 URL/도메인 항목 즉시 제거
     * - ['cache','series']   : 캐시 시계열 — Dashboard·도메인 detail 차트가 stale로 남지 않도록 (#333 패턴)
     * - ['domains','summary']: 도메인별 캐시 지표 표 — 퍼지 직후 행별 크기/엔트리 즉시 갱신
     * - ['domain', target]   : type==='domain' 인 경우 해당 도메인 detail/host-summary/stats/top-urls/logs 트리 prefix 무효화
     */
    onSuccess: (_data, req) => {
      void queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'series'] });
      void queryClient.invalidateQueries({ queryKey: ['domains', 'summary'] });
      // 도메인 스코프 퍼지일 때만 해당 도메인 detail 트리도 즉시 무효화 (usePurgeDomain #333 패턴과 일치).
      if (req.type === 'domain' && req.target) {
        void queryClient.invalidateQueries({ queryKey: ['domain', req.target] });
      }
    },
  });
}
