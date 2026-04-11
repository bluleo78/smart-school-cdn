/// 캐시 히트율 카드 — 히트율 % + HIT/MISS 카운트 표시
import { useCacheStats } from '../../hooks/useCacheStats';

export function CacheHitRateCard() {
  const { data, isLoading } = useCacheStats();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6" data-testid="cache-hit-rate-loading">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-8 w-20 rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  const hitRate = data?.hit_rate ?? 0;
  const hitCount = data?.hit_count ?? 0;
  const missCount = data?.miss_count ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6" data-testid="cache-hit-rate-card">
      <h3 className="text-sm font-medium text-gray-500 mb-3">캐시 히트율</h3>
      <p className="text-2xl font-bold text-blue-600 mb-2">{hitRate.toFixed(1)}%</p>
      <div className="flex gap-3 text-xs text-gray-500">
        <span>HIT {hitCount.toLocaleString()}</span>
        <span>MISS {missCount.toLocaleString()}</span>
      </div>
    </div>
  );
}
