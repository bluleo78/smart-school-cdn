/// 프록시 온라인/오프라인 상태를 보여주는 카드 컴포넌트
/// 5초 간격으로 API를 폴링하여 상태를 갱신한다.
import { useProxyStatus } from '../../hooks/useProxyStatus';

/** 초 단위 업타임을 "N시간 M분" 형식으로 변환 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

export function ProxyStatusCard() {
  const { data, isLoading } = useProxyStatus();

  // 로딩 중일 때 스켈레톤 표시
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6" data-testid="proxy-status-loading">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-8 w-32 rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  // 온라인 여부에 따라 배지 색상 결정
  const isOnline = data?.online ?? false;
  const uptime = data?.uptime ?? 0;
  const requestCount = data?.request_count ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-3">프록시 상태</h3>

      {/* 온라인/오프라인 배지 */}
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isOnline
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {isOnline ? '온라인' : '오프라인'}
        </span>
      </div>

      {/* 업타임 + 요청 수 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500">업타임</p>
          <p className="text-lg font-semibold">{formatUptime(uptime)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">총 요청 수</p>
          <p className="text-lg font-semibold">{requestCount}</p>
        </div>
      </div>
    </div>
  );
}
