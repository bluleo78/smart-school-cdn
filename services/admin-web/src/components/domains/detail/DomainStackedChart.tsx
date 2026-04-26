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
  const { data: buckets, isLoading } = useCacheSeries(range, host);

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
            <ChartTooltip formatter={(v: number) => v.toLocaleString()} />
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
