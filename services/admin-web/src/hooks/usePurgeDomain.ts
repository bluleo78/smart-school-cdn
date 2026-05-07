/// 도메인 캐시 퍼지 뮤테이션 훅
/// mutationKey를 부여해 useMutationState로 in-flight host 집합을 추적한다 (#205).
import { useMutation, useMutationState } from '@tanstack/react-query';
import { toast } from 'sonner';
import { purgeDomain } from '../api/domains';

/**
 * 퍼지 뮤테이션의 mutationKey — useMutationState 필터로 동일 키의
 * 모든 in-flight 인스턴스를 잡기 위해 상수로 노출한다 (#205).
 */
export const PURGE_DOMAIN_MUTATION_KEY = ['purge-domain'] as const;

export function usePurgeDomain() {
  return useMutation({
    mutationKey: PURGE_DOMAIN_MUTATION_KEY,
    mutationFn: (host: string) => purgeDomain(host),
    onSuccess: () => {
      toast.success('캐시가 퍼지되었습니다.');
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
