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
          <Card key={i}>
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
      <Card data-testid="summary-card-total">
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
      <Card data-testid="summary-card-requests">
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
      <Card data-testid="summary-card-cache-hit">
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

      {/* 카드 4: 대역폭 — min-w-0/truncate로 텍스트가 스파크라인 영역과 충돌하지 않도록 보호 */}
      <Card data-testid="summary-card-bandwidth">
        <CardHeader><CardTitle>오늘 대역폭</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2">
            {/* flex-1 min-w-0: 남은 너비를 모두 사용하되 0까지 수축 허용 — 스파크라인이 shrink-0으로 자리 확보 */}
            <div className="min-w-0 flex-1">
              <p className="text-3xl font-bold truncate">{formatBytes(data?.todayBandwidth ?? 0)}</p>
              {/* whitespace-nowrap: "절감량" 3글자가 세로로 분리되지 않도록 줄바꿈 방지 */}
              <span className="text-xs text-muted-foreground whitespace-nowrap">절감량</span>
            </div>
            {/* shrink-0 래퍼: 스파크라인 너비를 고정하여 텍스트 영역이 잠식당하지 않게 함 */}
            <div className="shrink-0">
              <BarSparkline values={data?.hourlyBandwidth ?? Array(24).fill(0)} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
