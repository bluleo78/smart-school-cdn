/// 캐시 항목 수 카드 — 저장된 URL 수 표시
import { useCacheStats } from '../../hooks/useCacheStats';

export function EntryCountCard() {
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
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-3">캐시 항목 수</h3>
      <p className="text-2xl font-bold text-green-600 mb-2">
        {(data?.entry_count ?? 0).toLocaleString()}
      </p>
      <p className="text-xs text-gray-500">저장된 URL</p>
    </div>
  );
}
