/// L1 히트율 카드 — 재설계 후 대시보드의 메인 메트릭.
/// L1은 메모리(가장 빠른) 캐시 계층이므로 성공 컬러로 강조한다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

/** 비율(0-1) → "%" 문자열 포매터 */
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function CacheHitRateCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card data-testid="cache-hit-rate-loading">
        <CardHeader><CardTitle>L1 히트율</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-28" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>L1 히트율</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="cache-hit-rate-card">
      <CardHeader><CardTitle>L1 히트율</CardTitle></CardHeader>
      <CardContent>
        <p
          className="text-3xl font-bold tabular-nums text-success"
          data-testid="dashboard-l1-hit-rate"
        >
          {fmtPct(data.l1_hit_rate)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          L1 HIT {data.l1_hits.toLocaleString()} / 요청 {data.requests.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
