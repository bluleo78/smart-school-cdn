/// 스토리지 사용량 카드 — 프로그레스 바 + 현재/최대 용량
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatBytes } from '../../lib/format';

export function StorageUsageCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  const used = data?.total_size_bytes ?? 0;
  const max = data?.max_size_bytes ?? 1;
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const barColor = pct > 80 ? 'bg-destructive' : pct > 60 ? 'bg-amber-500' : 'bg-primary';

  return (
    <Card data-testid="storage-usage-card">
      <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
      <CardContent>
        <p className="text-lg font-bold mb-2">{formatBytes(used)}</p>
        <div className="w-full bg-muted rounded-full h-2 mb-1">
          <div
            className={`${barColor} h-2 rounded-full transition-all`}
            style={{ width: `${pct}%` }}
            data-testid="storage-bar"
          />
        </div>
        <p className="text-xs text-muted-foreground">{pct.toFixed(1)}% / {formatBytes(max)}</p>
      </CardContent>
    </Card>
  );
}
