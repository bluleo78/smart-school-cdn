/// BYPASS 비율 카드 — 메소드/NoCache/크기/기타 사유로 캐시를 우회한 비율.
/// 값이 높다면 프록시 정책 튜닝 대상이므로 주의 지표로 운영한다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function BypassRateCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card variant="glass" data-testid="bypass-rate-loading">
        <CardHeader><CardTitle>BYPASS 비율</CardTitle></CardHeader>
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
        <CardHeader><CardTitle>BYPASS 비율</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass" data-testid="bypass-rate-card">
      <CardHeader><CardTitle>BYPASS 비율</CardTitle></CardHeader>
      <CardContent>
        <p
          className="text-3xl font-bold tabular-nums"
          data-testid="dashboard-bypass-rate"
        >
          {fmtPct(data.bypass_rate)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          BYPASS {data.bypass.total.toLocaleString()} / 요청 {data.requests.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
