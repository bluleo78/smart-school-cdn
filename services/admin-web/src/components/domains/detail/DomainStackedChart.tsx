/// 도메인 개요 탭 — 캐시 결과 분포 스택 영역 차트 (L1/L2/MISS/BYPASS)
import { useMemo, useState } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../ui/button';
import { useCacheSeries } from '../../../hooks/useCacheSeries';
import type { CacheSeriesRange } from '../../../api/cache';

interface Props {
  host: string;
}

/** 도메인별 캐시 결과 분포를 1h / 24h 범위로 스택 영역 차트로 표시 */
export function DomainStackedChart({ host }: Props) {
  /** 조회 범위 — 기본 1시간 */
  const [range, setRange] = useState<CacheSeriesRange>('1h');
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
    <Card data-testid="domain-overview-stacked-chart">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>캐시 결과 분포</CardTitle>
        {/* 범위 토글 버튼 */}
        <div className="flex gap-2">
          <Button
            variant={range === '1h' ? 'default' : 'outline'}
            onClick={() => setRange('1h')}
            className="px-3 py-1 text-xs"
          >
            1시간
          </Button>
          <Button
            variant={range === '24h' ? 'default' : 'outline'}
            onClick={() => setRange('24h')}
            className="px-3 py-1 text-xs"
          >
            24시간
          </Button>
        </div>
      </CardHeader>
      <CardContent className="h-64">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
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
      </CardContent>
    </Card>
  );
}
