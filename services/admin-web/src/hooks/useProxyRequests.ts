/// 최근 요청 로그 폴링 — 빈 배열일 때 점진적 backoff 적용 (#358).
///
/// 무엇을: 데이터가 비어있으면 폴링 간격을 5s → 10s → 20s → 30s 로 지수적 증가, 상한 30s.
///         데이터가 채워지면 즉시 5s 로 복귀.
/// 왜: 트래픽이 적은 학교/야간 환경에서 12 req/min 의 빈 페치가 무의미하게 누적된다.
///     서버 부하·로그 노이즈·네트워크 사용을 비례적으로 줄이면서, 데이터가 도착하면
///     즉시 정상 속도로 복귀해 라이브 갱신 UX 를 보존한다.
import { useQuery } from '@tanstack/react-query';
import { fetchProxyRequests } from '../api/proxy';

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_MAX_INTERVAL_MS = 30_000;

export function useProxyRequests() {
  return useQuery({
    queryKey: ['proxy', 'requests'],
    queryFn: fetchProxyRequests,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.length > 0) {
        // 활성 — 정상 속도로 즉시 복귀
        return ACTIVE_INTERVAL_MS;
      }
      // 빈 배열 연속 응답이면 간격을 두 배씩 늘리되 상한 30s. 직전 fetch interval 을 따라 증가.
      // dataUpdateCount 가 1 일 때 첫 backoff(10s) → 누적 fetch 수가 늘수록 30s 로 수렴.
      const failures = query.state.dataUpdateCount;
      const next = ACTIVE_INTERVAL_MS * Math.min(8, Math.max(1, Math.pow(2, Math.max(0, failures - 1))));
      return Math.min(IDLE_MAX_INTERVAL_MS, next);
    },
  });
}
