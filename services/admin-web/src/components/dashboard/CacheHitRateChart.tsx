/// 캐시 결과 분포 시계열 — L1 / L2 / MISS / BYPASS 4층 100% 스택 영역 차트.
/// 재설계 전엔 단일 '히트율 추이' 라인이었으나, 각 레이어의 기여를 한눈에 비교 가능하도록
/// 스택 영역으로 변경. 1시간/24시간 범위 토글 제공, 10초 주기 자동 갱신.
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
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { useCacheSeries } from '../../hooks/useCacheSeries';
import type { CacheSeriesRange } from '../../api/cache';

export function CacheHitRateChart() {
  const [range, setRange] = useState<CacheSeriesRange>('1h');
  const { data: buckets, isLoading, error } = useCacheSeries(range);

  /** 버킷 epoch-ms → 현지 HH:MM:SS 문자열 변환 + Recharts 친화적 키로 평탄화 */
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
    <Card data-testid="cache-stacked-chart" className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>캐시 결과 분포 (100% 스택)</CardTitle>
        <div className="flex gap-2">
          <Button
            variant={range === '1h' ? 'default' : 'outline'}
            onClick={() => setRange('1h')}
            data-testid="cache-range-1h"
            size="xs"
          >
            1시간
          </Button>
          <Button
            variant={range === '24h' ? 'default' : 'outline'}
            onClick={() => setRange('24h')}
            data-testid="cache-range-24h"
            size="xs"
          >
            24시간
          </Button>
        </div>
      </CardHeader>
      <CardContent className="h-72">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">연결 실패</p>
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
