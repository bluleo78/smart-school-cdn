/// 총 요청 카드 — 재설계 이후 bandwidth 필드가 `CacheStats`에서 제거됨.
/// 해당 슬롯은 24h 총 요청수를 노출해 전체 트래픽 규모를 파악할 수 있게 한다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export function BandwidthSavedCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>총 요청 (24h)</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-8 w-24" /></CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>총 요청 (24h)</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass" data-testid="total-requests-card">
      <CardHeader><CardTitle>총 요청 (24h)</CardTitle></CardHeader>
      <CardContent>
        <p
          className="text-3xl font-bold tabular-nums"
          data-testid="dashboard-total-requests"
        >
          {data.requests.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-1">최근 24시간 누적 요청 수</p>
      </CardContent>
    </Card>
  );
}
