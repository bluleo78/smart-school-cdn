/// 대역폭 절감 카드 — 캐시 HIT으로 절감한 추정 트래픽량 표시
import { useCacheStats } from '../../hooks/useCacheStats';
import { formatBytes } from '../../lib/format';

export function BandwidthSavedCard() {
  const { data, isLoading } = useCacheStats();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="h-8 w-20 rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  /// 캐시된 총 바이트 크기를 대역폭 절감 추정치로 사용한다
  const savedBytes = data?.by_domain.reduce((acc, d) => acc + d.size_bytes, 0) ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-3">대역폭 절감</h3>
      <p className="text-2xl font-bold text-purple-600 mb-2">{formatBytes(savedBytes)}</p>
      <p className="text-xs text-gray-500">이번 세션 누적</p>
    </div>
  );
}
