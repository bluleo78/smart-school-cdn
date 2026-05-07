/// 도메인 활성/비활성 토글 뮤테이션 훅
/// mutationKey를 부여해 useMutationState로 in-flight host 집합을 추적한다 (#205).
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toggleDomain } from '../api/domains';

/**
 * 토글 뮤테이션의 mutationKey — useMutationState 필터로 동일 키의
 * 모든 in-flight 인스턴스를 잡기 위해 상수로 노출한다 (#205).
 */
export const TOGGLE_DOMAIN_MUTATION_KEY = ['toggle-domain'] as const;

export function useToggleDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: TOGGLE_DOMAIN_MUTATION_KEY,
    mutationFn: (host: string) => toggleDomain(host),
    onSuccess: (data, host) => {
      void queryClient.invalidateQueries({ queryKey: ['domains'] });
      void queryClient.invalidateQueries({ queryKey: ['domain', host] });
      const label = data.enabled ? '활성화' : '비활성화';
      toast.success(`도메인이 ${label}되었습니다.`);
    },
    onError: () => {
      toast.error('도메인 토글에 실패했습니다.');
    },
  });
}

/**
 * 현재 in-flight인 토글 뮤테이션의 host 집합을 반환한다 (#205).
 * - 동일 mutationKey의 모든 mutation 인스턴스를 살펴 status==='pending'인 것의 variables(host)만 모은다.
 * - 단일 useMutation 인스턴스가 최신 호출의 variables만 보존하는 한계를 우회해
 *   서로 다른 행을 빠르게 연속 클릭해도 모든 진행 중인 행을 disabled로 유지할 수 있게 한다.
 */
export function usePendingToggleHosts(): Set<string> {
  const pendingHosts = useMutationState({
    filters: { mutationKey: TOGGLE_DOMAIN_MUTATION_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as string | undefined,
  });
  return new Set(pendingHosts.filter((h): h is string => typeof h === 'string'));
}
