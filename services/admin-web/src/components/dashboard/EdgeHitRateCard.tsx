/// 엣지 히트율 카드 — L1+L2 통합 히트율(= 오리진을 건드리지 않은 비율).
/// L1 대비 보조 지표이므로 컬러 강조 없이 중립 톤으로 표시한다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function EdgeHitRateCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card variant="glass" data-testid="edge-hit-rate-loading">
        <CardHeader><CardTitle>엣지 히트율 (L1+L2)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-28" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>엣지 히트율 (L1+L2)</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  const edgeHits = data.l1_hits + data.l2_hits;

  return (
    <Card variant="glass" data-testid="edge-hit-rate-card">
      <CardHeader><CardTitle>엣지 히트율 (L1+L2)</CardTitle></CardHeader>
      <CardContent>
        <p
          className="text-3xl font-bold tabular-nums"
          data-testid="dashboard-edge-hit-rate"
        >
          {fmtPct(data.edge_hit_rate)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          엣지 HIT {edgeHits.toLocaleString()} / 요청 {data.requests.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
