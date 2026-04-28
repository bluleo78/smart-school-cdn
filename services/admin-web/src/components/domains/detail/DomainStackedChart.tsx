/// 도메인 개요 탭 — 캐시 결과 분포 스택 영역 차트 (L1/L2/MISS/BYPASS)
/// 범위 토글은 부모 DomainCacheSection 이 관리하고, range prop 으로 주입받는다.
import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { BarChart2 } from 'lucide-react';
import { Skeleton } from '../../ui/skeleton';
import { useCacheSeries } from '../../../hooks/useCacheSeries';
import type { CacheSeriesRange } from '../../../api/cache';

interface Props {
  host: string;
  range: CacheSeriesRange;
}

/** 도메인별 캐시 결과 분포를 스택 영역 차트로 표시 */
export function DomainStackedChart({ host, range }: Props) {
  // isError를 함께 destructure하여 API 실패 시 에러 상태를 명시적으로 처리한다 (#154)
  const { data: buckets, isLoading, isError } = useCacheSeries(range, host);

  /** API 응답을 차트 데이터 형태로 변환 */
  const data = useMemo(
    () =>
      (buckets ?? []).map((b) => ({
        t: new Date(b.ts).toLocaleTimeString('ko-KR', { hour12: false }),
        l1_hits: b.l1_hits,
        l2_hits: b.l2_hits,
        miss: b.miss,
        bypass: b.bypass,
      })),
    [buckets],
  );

  return (
    <div className="h-64" data-testid="domain-overview-stacked-chart">
      {isLoading ? (
        <Skeleton className="h-full w-full" />
      ) : isError ? (
        // API 호출 실패 시 — "데이터 없음"과 구분하여 에러 메시지 표시 (#153 패턴 동일 적용)
        <p className="text-sm text-destructive">캐시 차트를 불러올 수 없습니다</p>
      ) : data.length === 0 ? (
        /* 데이터 없음 — 빈 캔버스 대신 안내 메시지로 대체 (CacheHitRateChart 패턴 준용) */
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <BarChart2 size={32} className="opacity-30" />
          <p className="text-sm">아직 데이터가 없습니다</p>
          <p className="text-xs">프록시로 요청이 들어오면 자동으로 표시됩니다</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="t" tick={{ fontSize: 10 }} />
            <YAxis
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10 }}
            />
            {/* stackOffset="expand" 사용 시 Recharts 내부값이 0~1 소수로 정규화됨.
                YAxis tickFormatter와 동일하게 백분율(%) 문자열로 변환해야 한다. */}
            <ChartTooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="l1_hits"
              name="L1-HIT"
              stackId="1"
              stroke="var(--color-success)"
              fill="var(--color-success)"
            />
            <Area
              type="monotone"
              dataKey="l2_hits"
              name="L2-HIT"
              stackId="1"
              stroke="var(--color-info)"
              fill="var(--color-info)"
            />
            <Area
              type="monotone"
              dataKey="miss"
              name="MISS"
              stackId="1"
              stroke="var(--color-warning)"
              fill="var(--color-warning)"
            />
            <Area
              type="monotone"
              dataKey="bypass"
              name="BYPASS"
              stackId="1"
              stroke="var(--color-muted-foreground)"
              fill="var(--color-muted-foreground)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
