/// 스토리지 사용량 카드 — 프로그레스 바 + 현재/최대 용량 표시
import { useCacheStats } from '../../hooks/useCacheStats';
import { formatBytes } from '../../lib/format';

export function StorageUsageCard() {
  const { data, isLoading } = useCacheStats();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  const used = data?.total_size_bytes ?? 0;
  const max = data?.max_size_bytes ?? 1;
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const barColor = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6" data-testid="storage-usage-card">
      <h3 className="text-sm font-medium text-gray-500 mb-3">스토리지 사용량</h3>
      <p className="text-lg font-bold text-amber-600 mb-2">{formatBytes(used)}</p>
      <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
        <div
          className={`${barColor} h-2 rounded-full transition-all`}
          style={{ width: `${pct}%` }}
          data-testid="storage-bar"
        />
      </div>
      <p className="text-xs text-gray-500">{pct.toFixed(1)}% / {formatBytes(max)}</p>
    </div>
  );
}
