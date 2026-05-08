/// 단일 도메인 조회 훅
import { useQuery } from '@tanstack/react-query';
import { fetchDomain, type Domain } from '../api/domains';

/**
 * 조회 실패가 "도메인이 존재하지 않음(404)"인지 판별한다 (#307).
 * - 404 만 진짜 not-found 로 취급하고, 5xx/네트워크 오류는 "일시적 실패" 로 분리한다.
 * - 5xx 일 때 강제 redirect 하면 사용자가 "도메인이 사라졌다" 고 오해할 수 있어
 *   호출부에서 인라인 에러 카드 + 재시도 버튼을 노출해야 한다.
 */
export function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return status === 404;
  }
  return false;
}

export function useDomain(host: string) {
  return useQuery<Domain>({
    queryKey: ['domain', host],
    queryFn: () => fetchDomain(host),
    enabled: !!host,
    // 404 는 retry 해도 결과가 바뀌지 않으므로 즉시 실패로 처리한다 (#307).
    // 5xx/네트워크는 React Query 기본 retry(3회)에 맡겨 일시 장애에 자동 회복한다.
    retry: (failureCount, err) => {
      if (isNotFoundError(err)) return false;
      return failureCount < 3;
    },
  });
}
