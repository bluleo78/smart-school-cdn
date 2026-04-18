/// 도메인 요약 통계 카드 4개 — 전체/오늘요청/캐시히트율/대역폭
import { useDomainSummary } from '../../hooks/useDomainSummary';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatBytes } from '../../lib/format';
import { BarSparkline, DeltaBadge } from './StatSparkline';

export function DomainSummaryCards() {
  const { data, isLoading } = useDomainSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4" data-testid="domain-summary-cards">
        {[...Array(4)].map((_, i) => (
          <Card key={i} variant="glass">
            <CardHeader><CardTitle><Skeleton className="h-4 w-24" /></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4" data-testid="domain-summary-cards">
      {/* 카드 1: 전체 도메인 (스파크라인 없음, 활성/비활성 카운트) */}
      <Card variant="glass" data-testid="summary-card-total">
        <CardHeader><CardTitle>전체 도메인</CardTitle></CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{data?.total ?? 0}</p>
          <div className="flex gap-3 mt-1">
            <span className="text-xs text-success">활성 {data?.enabled ?? 0}</span>
            <span className="text-xs text-muted-foreground">비활성 {data?.disabled ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      {/* 카드 2: 오늘 요청 */}
      <Card variant="glass" data-testid="summary-card-requests">
        <CardHeader><CardTitle>오늘 요청</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{(data?.todayRequests ?? 0).toLocaleString()}</p>
              <DeltaBadge delta={data?.todayRequestsDelta ?? 0} unit="%" />
            </div>
            <BarSparkline values={data?.hourlyRequests ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>

      {/* 카드 3: 캐시 히트율 */}
      <Card variant="glass" data-testid="summary-card-cache-hit">
        <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{((data?.cacheHitRate ?? 0) * 100).toFixed(1)}%</p>
              <DeltaBadge delta={data?.cacheHitRateDelta ?? 0} unit="%" />
            </div>
            <BarSparkline values={data?.hourlyCacheHitRate ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>

      {/* 카드 4: 대역폭 */}
      <Card variant="glass" data-testid="summary-card-bandwidth">
        <CardHeader><CardTitle>오늘 대역폭</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{formatBytes(data?.todayBandwidth ?? 0)}</p>
              <span className="text-xs text-muted-foreground">절감량</span>
            </div>
            <BarSparkline values={data?.hourlyBandwidth ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
