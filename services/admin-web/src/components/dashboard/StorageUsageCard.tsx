/// 스토리지 사용량 카드 — 프로그레스 바 + 현재/최대 용량.
/// 재설계 이후 `stats.disk.used_bytes`/`disk.max_bytes`에서 값을 읽는다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatBytes } from '../../lib/format';

export function StorageUsageCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="h-full">
        <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  const used = data.disk.used_bytes;
  const max = data.disk.max_bytes;
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const barColor = pct > 80 ? 'bg-destructive' : pct > 60 ? 'bg-warning' : 'bg-primary';

  return (
    <Card data-testid="storage-usage-card" className="h-full">
      <CardHeader><CardTitle>스토리지 사용량</CardTitle></CardHeader>
      <CardContent>
        <p className="text-lg font-bold mb-2">{formatBytes(used)}</p>
        <div
          className="w-full bg-muted rounded-full h-2 mb-1"
          data-testid="dashboard-disk-usage-bar"
        >
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
