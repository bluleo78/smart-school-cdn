/// 캐시 히트율 카드
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export function CacheHitRateCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card variant="glass" data-testid="cache-hit-rate-loading">
        <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-28" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass" data-testid="cache-hit-rate-card">
      <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{(data?.hit_rate ?? 0).toFixed(1)}%</p>
        <p className="text-xs text-muted-foreground mt-1">
          HIT {data?.hit_count ?? 0} / MISS {data?.miss_count ?? 0}
        </p>
      </CardContent>
    </Card>
  );
}
