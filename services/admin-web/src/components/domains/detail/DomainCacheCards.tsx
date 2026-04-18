/// 도메인 개요 탭 — L1 히트율 / 엣지 히트율 / BYPASS 비율 카드 3개
import { useDomainHostSummary } from '../../../hooks/useDomainHostSummary';
import { Card, CardContent } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';

/** 비율(0~1)을 퍼센트 문자열로 변환 */
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

interface Props {
  host: string;
}

/** 오늘의 L1/엣지/Bypass 비율을 카드 3개로 표시 */
export function DomainCacheCards({ host }: Props) {
  const { data: summary, isLoading } = useDomainHostSummary(host);

  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* L1 메모리 캐시 히트율 */}
      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">L1 히트율</p>
          <p
            className="mt-1 font-bold tabular-nums text-2xl text-success"
            data-testid="domain-overview-l1-hit-rate"
          >
            {fmtPct(summary.today_l1_hit_rate)}
          </p>
        </CardContent>
      </Card>

      {/* 엣지(L1+L2) 캐시 히트율 */}
      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">엣지 히트율</p>
          <p
            className="mt-1 font-bold tabular-nums text-2xl"
            data-testid="domain-overview-edge-hit-rate"
          >
            {fmtPct(summary.today_edge_hit_rate)}
          </p>
        </CardContent>
      </Card>

      {/* BYPASS 비율 */}
      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">BYPASS 비율</p>
          <p
            className="mt-1 font-bold tabular-nums text-2xl"
            data-testid="domain-overview-bypass-rate"
          >
            {fmtPct(summary.today_bypass_rate)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
