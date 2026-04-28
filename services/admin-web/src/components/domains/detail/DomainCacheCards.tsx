/// 도메인 개요 탭 — L1 히트율 / 엣지 히트율 / BYPASS 비율 카드 3개
/// 범위(1h/24h)에 따른 series 버킷을 합산해 비율을 계산한다. 범위는 부모에서 주입.
import { useMemo } from 'react';
import { useCacheSeries } from '../../../hooks/useCacheSeries';
import { Card, CardContent } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import type { CacheSeriesRange } from '../../../api/cache';

/** 비율(0~1)을 퍼센트 문자열로 변환 */
function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

interface Props {
  host: string;
  range: CacheSeriesRange;
}

/** 지정 범위의 series 버킷을 합산해 L1/엣지/Bypass 비율 카드 3개를 표시 */
export function DomainCacheCards({ host, range }: Props) {
  // isError를 함께 destructure하여 API 실패 시 에러 상태를 명시적으로 처리한다 (#154)
  const { data: buckets, isLoading, isError } = useCacheSeries(range, host);

  /** 버킷 합산 후 비율 산출 — 분모는 l1+l2+miss+bypass */
  const rates = useMemo(() => {
    const t = (buckets ?? []).reduce(
      (a, b) => ({
        l1: a.l1 + b.l1_hits,
        l2: a.l2 + b.l2_hits,
        miss: a.miss + b.miss,
        bypass: a.bypass + b.bypass,
      }),
      { l1: 0, l2: 0, miss: 0, bypass: 0 },
    );
    const total = t.l1 + t.l2 + t.miss + t.bypass;
    return {
      l1: total > 0 ? t.l1 / total : 0,
      edge: total > 0 ? (t.l1 + t.l2) / total : 0,
      bypass: total > 0 ? t.bypass / total : 0,
    };
  }, [buckets]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  // API 호출 실패 시 — 0% 오표시 대신 에러 메시지 표시 (#153 패턴 동일 적용)
  if (isError) {
    return <p className="text-sm text-destructive">캐시 통계를 불러올 수 없습니다</p>;
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
            {fmtPct(rates.l1)}
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
            {fmtPct(rates.edge)}
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
            {fmtPct(rates.bypass)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
