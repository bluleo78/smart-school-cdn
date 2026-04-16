/// 도메인 통계 탭 — 기간 선택 + HIT/MISS 바 차트 + 대역폭/응답시간 에어리어 차트 + 인기 콘텐츠 + 최적화 절감 + 로그 테이블
import { useState } from 'react';
import { useDomainStats } from '../../../hooks/useDomainStats';
import { formatBytes } from '../../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { DomainLogTable } from './DomainLogTable';
import { DomainPopularContent } from './DomainPopularContent';
import { DomainOptimizationStats } from './DomainOptimizationStats';

type Period = '24h' | '7d' | '30d';

interface Props {
  host: string;
}

const PERIOD_LABELS: { value: Period; label: string }[] = [
  { value: '24h', label: '24시간' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
];

export function DomainStatsTab({ host }: Props) {
  /** 선택된 기간 — 기본값 24h */
  const [period, setPeriod] = useState<Period>('24h');

  const { data, isLoading, error } = useDomainStats(host, period);

  return (
    <div className="space-y-4" data-testid="domain-stats-tab">
      {/* 기간 선택 버튼 그룹 */}
      <div className="flex gap-2">
        {PERIOD_LABELS.map(({ value, label }) => (
          <Button
            key={value}
            variant={period === value ? 'default' : 'outline'}
            onClick={() => setPeriod(value)}
            aria-pressed={period === value}
            className="h-8 text-xs py-1 px-3"
          >
            {label}
          </Button>
        ))}
      </div>

      {/* 차트 영역 */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">통계 로드 실패</p>
      ) : data ? (
        <div className="grid grid-cols-2 gap-4">
          {/* 왼쪽: 요청 수 추이 — HIT/MISS 스택 바 차트 */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-sm">요청 수 추이</CardTitle>
            </CardHeader>
            <CardContent>
              <HitMissBarChart
                labels={data.timeseries.labels}
                hits={data.timeseries.hits}
                misses={data.timeseries.misses}
              />
            </CardContent>
          </Card>

          {/* 오른쪽: 대역폭 & 응답 시간 에어리어 차트 */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-sm">대역폭 &amp; 응답 시간</CardTitle>
            </CardHeader>
            <CardContent>
              <BandwidthResponseChart
                labels={data.timeseries.labels}
                bandwidth={data.timeseries.bandwidth}
                responseTime={data.timeseries.responseTime}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* 인기 콘텐츠 */}
      <DomainPopularContent host={host} />

      {/* 최적화 절감 통계 */}
      <DomainOptimizationStats host={host} />

      {/* 하단: 요청 로그 테이블 */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle className="text-sm">요청 로그</CardTitle>
        </CardHeader>
        <CardContent>
          <DomainLogTable host={host} />
        </CardContent>
      </Card>
    </div>
  );
}

/** HIT/MISS 스택 바 차트 — CSS div 기반 */
function HitMissBarChart({
  labels,
  hits,
  misses,
}: {
  labels: string[];
  hits: number[];
  misses: number[];
}) {
  if (labels.length === 0) {
    return <p className="text-xs text-muted-foreground">데이터 없음</p>;
  }

  /** 각 구간 최대 합산값으로 높이 비율 계산 */
  const maxTotal = Math.max(...hits.map((h, i) => h + misses[i]), 1);

  return (
    <div className="space-y-2">
      {/* 범례 */}
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-green-500" />
          HIT
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-destructive" />
          MISS
        </span>
      </div>

      {/* 바 차트 */}
      <div className="flex items-end gap-0.5 h-32">
        {labels.map((label, i) => {
          const total = hits[i] + misses[i];
          const heightPct = (total / maxTotal) * 100;
          const hitPct = total > 0 ? (hits[i] / total) * 100 : 50;
          const missPct = 100 - hitPct;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${label}: HIT ${hits[i]}, MISS ${misses[i]}`}
            >
              <div
                className="w-full rounded-sm overflow-hidden"
                style={{ height: `${heightPct}%`, minHeight: total > 0 ? 2 : 0 }}
              >
                {/* MISS (위) */}
                <div
                  className="w-full bg-destructive/70"
                  style={{ height: `${missPct}%` }}
                />
                {/* HIT (아래) */}
                <div
                  className="w-full bg-green-500/70"
                  style={{ height: `${hitPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* X축 레이블 — 처음/중간/끝만 표시 */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** 대역폭 & 응답시간 에어리어 차트 — CSS div 기반 */
function BandwidthResponseChart({
  labels,
  bandwidth,
  responseTime,
}: {
  labels: string[];
  bandwidth: number[];
  responseTime: number[];
}) {
  if (labels.length === 0) {
    return <p className="text-xs text-muted-foreground">데이터 없음</p>;
  }

  const maxBw = Math.max(...bandwidth, 1);
  const maxRt = Math.max(...responseTime, 1);

  return (
    <div className="space-y-3">
      {/* 대역폭 에어리어 */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">대역폭</p>
        <MiniAreaChart
          values={bandwidth}
          maxValue={maxBw}
          color="var(--color-primary)"
          formatValue={formatBytes}
        />
      </div>

      {/* 응답 시간 에어리어 */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">응답 시간</p>
        <MiniAreaChart
          values={responseTime}
          maxValue={maxRt}
          color="rgb(168 85 247)"
          formatValue={(v) => `${v}ms`}
        />
      </div>

      {/* X축 레이블 */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/** 단순 에어리어 차트 — SVG polyline + fill */
function MiniAreaChart({
  values,
  maxValue,
  color,
  formatValue,
}: {
  values: number[];
  maxValue: number;
  color: string;
  formatValue: (v: number) => string;
}) {
  const W = 300;
  const H = 48;
  const n = values.length;

  if (n === 0) return null;

  /** SVG 좌표 계산 */
  const pts = values.map((v, i) => ({
    x: (i / Math.max(n - 1, 1)) * W,
    y: H - (v / maxValue) * H,
  }));

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${pts[0].x},${H} ${polyline} ${pts[n - 1].x},${H}`;

  /** 현재 최댓값 레이블 */
  const maxVal = Math.max(...values);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
        <polygon points={area} fill={color} fillOpacity={0.15} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
      <span className="absolute top-0 right-0 text-xs text-muted-foreground">
        {formatValue(maxVal)}
      </span>
    </div>
  );
}
