/// 도메인 캐시 퍼지 뮤테이션 훅
/// mutationKey를 부여해 useMutationState로 in-flight host 집합을 추적한다 (#205).
/// onSuccess에서 cache(popular/stats/series) + 해당 domain 트리 쿼리를 invalidate해
/// 퍼지 직후 KPI/차트/인기 URL/도메인 detail이 즉시 갱신되도록 한다 (#333).
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { purgeDomain } from '../api/domains';

/**
 * 퍼지 뮤테이션의 mutationKey — useMutationState 필터로 동일 키의
 * 모든 in-flight 인스턴스를 잡기 위해 상수로 노출한다 (#205).
 */
export const PURGE_DOMAIN_MUTATION_KEY = ['purge-domain'] as const;

export function usePurgeDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PURGE_DOMAIN_MUTATION_KEY,
    mutationFn: (host: string) => purgeDomain(host),
    /**
     * 도메인 퍼지 성공 시 stale 캐시를 무효화한다 (#333).
     * - ['cache','popular']  : 전역 인기 URL Top — 퍼지된 도메인 항목 갱신
     * - ['cache','stats']    : 전역 캐시 stats — 캐시 크기/엔트리 수 즉시 반영
     * - ['cache','series']   : 캐시 시계열 — 차트가 stale 상태로 남지 않도록
     * - ['domain', host]     : 해당 도메인 detail/host-summary/stats/top-urls/logs/url-optimization 트리 전체 prefix
     */
    onSuccess: (_data, host) => {
      toast.success('캐시가 퍼지되었습니다.');
      void queryClient.invalidateQueries({ queryKey: ['cache', 'popular'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['cache', 'series'] });
      void queryClient.invalidateQueries({ queryKey: ['domain', host] });
    },
    onError: () => {
      toast.error('캐시 퍼지에 실패했습니다.');
    },
  });
}

/**
 * 현재 in-flight인 퍼지 뮤테이션의 host 집합을 반환한다 (#205).
 * - 동일 mutationKey의 모든 mutation 인스턴스 중 status==='pending'인 것의 variables(host)만 모은다.
 * - 단일 useMutation 인스턴스가 최신 variables만 보존하는 한계를 우회한다.
 */
export function usePendingPurgeHosts(): Set<string> {
  const pendingHosts = useMutationState({
    filters: { mutationKey: PURGE_DOMAIN_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as string | undefined,
  });
  return new Set(pendingHosts.filter((h): h is string => typeof h === 'string'));
}
