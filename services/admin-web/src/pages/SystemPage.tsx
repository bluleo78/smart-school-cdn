/** 시스템 페이지 v1
 * - 서버 업타임 표시 (ProxyStatus.uptime 활용)
 * - 디스크 사용량 경고 배너 (90% 이상 시 표시)
 */
import { useProxyStatus } from '../hooks/useProxyStatus';
import { useCacheStats } from '../hooks/useCacheStats';
import { Link } from 'react-router';

/** 초 → "X일 X시간 X분" 포맷 변환 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  parts.push(`${minutes}분`);
  return parts.join(' ');
}

export function SystemPage() {
  const { data: status } = useProxyStatus();
  const { data: cache } = useCacheStats();

  const diskUsageRatio =
    cache && cache.max_size_bytes > 0
      ? cache.total_size_bytes / cache.max_size_bytes
      : 0;
  const diskUsagePercent = Math.round(diskUsageRatio * 100);
  const isDiskWarning = diskUsageRatio >= 0.9;

  const diskUsedGB = cache
    ? (cache.total_size_bytes / 1024 ** 3).toFixed(1)
    : '-';
  const diskMaxGB = cache
    ? (cache.max_size_bytes / 1024 ** 3).toFixed(1)
    : '-';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">시스템</h2>

      {/* 디스크 사용량 경고 배너 */}
      {isDiskWarning && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">
            캐시 디스크 사용량이 {diskUsagePercent}%입니다.
          </p>
          <p className="mt-1 text-sm">
            오래된 캐시를 퍼지하거나 최대 용량을 늘리세요.{' '}
            <Link to="/cache" className="underline">
              캐시 관리 페이지로 이동
            </Link>
          </p>
        </div>
      )}

      {/* 서버 업타임 */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-700">서버 업타임</h3>
        <p
          data-testid="uptime-value"
          className="text-3xl font-bold text-gray-900"
        >
          {status ? formatUptime(status.uptime) : '로딩 중…'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {status?.online ? '● 온라인' : '○ 오프라인'}
        </p>
      </div>

      {/* 캐시 디스크 사용량 */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-700">
          캐시 디스크 사용량
        </h3>
        <div className="mb-2 flex justify-between text-sm text-gray-600">
          <span>{diskUsedGB} GB 사용</span>
          <span>{diskMaxGB} GB 최대</span>
        </div>
        <div
          data-testid="disk-usage-bar"
          className="h-3 w-full overflow-hidden rounded-full bg-gray-200"
        >
          <div
            className={`h-full rounded-full transition-all ${
              isDiskWarning ? 'bg-red-500' : 'bg-blue-500'
            }`}
            style={{ width: `${diskUsagePercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">{diskUsagePercent}% 사용 중</p>
      </div>
    </div>
  );
}
