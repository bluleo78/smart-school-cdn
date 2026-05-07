/// 도메인 요약 통계 카드 4개 — 전체/오늘요청/캐시히트율/대역폭
import { useDomainSummary } from '../../hooks/useDomainSummary';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatBytes } from '../../lib/format';
import { BarSparkline, DeltaBadge } from './StatSparkline';

export function DomainSummaryCards() {
  // error: API 요청 실패 여부 — isError가 true이면 0 fallback 대신 에러 메시지 표시 (#104)
  const { data, isLoading, isError } = useDomainSummary();

  // API 실패 시 0으로 오해하지 않도록 에러 상태를 명시적으로 표시한다
  if (isError) {
    return (
      <p className="text-sm text-destructive" data-testid="domain-summary-error">
        요약 정보를 불러오지 못했습니다.
      </p>
    );
  }

  if (isLoading) {
    // md(768px) 미만에서 2열로 전환하여 카드 너비 확보 — BarSparkline overflow 방지 (#71)
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="domain-summary-cards">
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
    // md(768px) 미만에서 2열로 전환하여 카드 너비 확보 — BarSparkline overflow 방지 (#71)
    // 4개 카드 동일 수직 stack 룰 적용: 제목 → 숫자 → delta(or 보조라벨) → 그래프 (#256)
    // overflow-hidden: BarSparkline(24바 × 5px)이 카드 경계를 초과하지 않도록 클리핑 (#129)
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="domain-summary-cards">
      {/* 카드 1: 전체 도메인 — 스파크라인 슬롯은 비워 두되 다른 카드와 높이 정렬 위해 placeholder 유지 (#256) */}
      <Card data-testid="summary-card-total">
        <CardHeader><CardTitle>전체 도메인</CardTitle></CardHeader>
        <CardContent className="overflow-hidden">
          <p className="text-3xl font-bold">{data?.total ?? 0}</p>
          {/* delta 위치 슬롯 — 활성/비활성 카운트로 대체 (delta 개념 없음) */}
          <div className="flex gap-3 mt-1">
            <span className="text-xs text-success">활성 {data?.enabled ?? 0}</span>
            <span className="text-xs text-muted-foreground">비활성 {data?.disabled ?? 0}</span>
          </div>
          {/* 그래프 슬롯 — 스파크라인 없음. h-9으로 4카드 높이 동기화 (#256) */}
          <div className="h-9 mt-2" aria-hidden="true" />
        </CardContent>
      </Card>

      {/* 카드 2: 오늘 요청 */}
      <Card data-testid="summary-card-requests">
        <CardHeader><CardTitle>오늘 요청</CardTitle></CardHeader>
        <CardContent className="overflow-hidden">
          <p className="text-3xl font-bold">{(data?.todayRequests ?? 0).toLocaleString()}</p>
          <div className="mt-1">
            <DeltaBadge delta={data?.todayRequestsDelta ?? 0} unit="%" />
          </div>
          <div className="mt-2">
            <BarSparkline values={data?.hourlyRequests ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>

      {/* 카드 3: 캐시 히트율 */}
      <Card data-testid="summary-card-cache-hit">
        <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
        <CardContent className="overflow-hidden">
          <p className="text-3xl font-bold">{((data?.cacheHitRate ?? 0) * 100).toFixed(1)}%</p>
          <div className="mt-1">
            <DeltaBadge delta={data?.cacheHitRateDelta ?? 0} unit="%" />
          </div>
          <div className="mt-2">
            <BarSparkline values={data?.hourlyCacheHitRate ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>

      {/* 카드 4: 대역폭 — whitespace-nowrap으로 포맷된 bytes 값이 줄바꿈 없이 표시되도록 */}
      {/* API에 todayBandwidthDelta 미제공 — 다른 카드와 라인 정렬 유지 위해 중립 DeltaBadge 사용 (#256) */}
      <Card data-testid="summary-card-bandwidth">
        <CardHeader><CardTitle>오늘 대역폭</CardTitle></CardHeader>
        <CardContent className="overflow-hidden">
          {/* whitespace-nowrap: "0 B" / "1.2 MB" 등이 공백 기준으로 줄바꿈되지 않도록 */}
          <p className="text-3xl font-bold whitespace-nowrap">{formatBytes(data?.todayBandwidth ?? 0)}</p>
          <div className="mt-1">
            <DeltaBadge delta={0} unit="%" />
          </div>
          <div className="mt-2">
            <BarSparkline values={data?.hourlyBandwidth ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
