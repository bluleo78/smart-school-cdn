/// 도메인 로그 탭 — 기간 토글 + 자동갱신 드롭다운 + 수동 새로고침 + 트래픽 차트 + Top URL + 로그 테이블.
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { PeriodSelector, type PeriodValue } from './PeriodSelector';
import { RefreshIntervalSelect, type RefreshIntervalMs } from './RefreshIntervalSelect';
import { ManualRefreshButton } from './ManualRefreshButton';
import { DomainTopUrlsCard } from './DomainTopUrlsCard';
import { DomainLogTable } from './DomainLogTable';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { useDomainStats } from '../../../hooks/useDomainStats';
import { formatBytes } from '../../../lib/format';

interface Props {
  host: string;
  /** 조회 기간 — 부모(DomainDetailTabs)에서 관리하여 탭 전환 시에도 값이 유지된다 (#133) */
  period: PeriodValue;
  onPeriodChange: (v: PeriodValue) => void;
  /** 자동 갱신 주기 — 부모(DomainDetailTabs)에서 관리하여 탭 전환 시에도 값이 유지된다 (#133) */
  refresh: RefreshIntervalMs;
  onRefreshChange: (v: RefreshIntervalMs) => void;
}

export function DomainLogsTab({ host, period, onPeriodChange, refresh, onRefreshChange }: Props) {
  const qc = useQueryClient();

  /** custom 기간일 때만 from/to 범위 추출 */
  const range =
    period.period === 'custom' && period.from !== undefined && period.to !== undefined
      ? { from: period.from, to: period.to }
      : undefined;

  /**
   * 이 도메인의 logs/top-urls 쿼리 중 하나라도 fetching 중이면 true.
   * useIsFetching으로 집계하여 ManualRefreshButton.isRefreshing에 전달 — 중복 클릭 방지 (#144).
   */
  const isFetching = useIsFetching({ queryKey: ['domain', host] }) > 0;

  /** 수동 새로고침 — logs와 top-urls 쿼리 모두 무효화 */
  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['domain', host, 'logs'] });
    qc.invalidateQueries({ queryKey: ['domain', host, 'top-urls'] });
  }

  return (
    <div className="space-y-6" data-testid="domain-traffic-tab">
      {/* 기간 선택 + 자동갱신 + 수동 새로고침 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={onPeriodChange} />
        <div className="flex items-center gap-2">
          <RefreshIntervalSelect value={refresh} onChange={onRefreshChange} />
          <ManualRefreshButton onClick={handleRefresh} isRefreshing={isFetching} />
        </div>
      </div>

      {/* 트래픽 차트 섹션 — 요청 수 추이 + 대역폭/응답시간 */}
      <DomainTrafficChartsSection host={host} period={period} range={range} />

      {/* Top URL 집계 카드 */}
      <DomainTopUrlsCard
        host={host}
        period={period.period}
        range={range}
        refetchIntervalMs={refresh}
      />

      {/* 요청 로그 테이블 */}
      <DomainLogTable
        host={host}
        period={period.period}
        range={range}
        refetchIntervalMs={refresh}
      />
    </div>
  );
}

/** 트래픽 차트 섹션 래퍼 — useDomainStats 훅으로 시계열 가져와 두 개 카드에 표시 */
function DomainTrafficChartsSection({
  host, period, range,
}: {
  host: string;
  period: PeriodValue;
  range?: { from: number; to: number };
}) {
  // isError를 함께 destructure하여 API 실패 시 에러 상태를 명시적으로 처리한다 (#153)
  const { data, isLoading, isError } = useDomainStats(host, period.period, range);
  return (
    <Card data-testid="traffic-charts-section">
      <CardHeader><CardTitle className="text-base font-semibold">요청 추이</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          // API 호출 실패 시 에러 메시지 표시 — DomainTopUrlsCard (#148) 패턴 동일 적용
          <p className="text-sm text-destructive">요청 추이를 불러올 수 없습니다</p>
        ) : !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          // 모바일(기본) 1열, 데스크톱(md 이상) 2열 — Tailwind mobile-first 순서 수정 (#85)
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="traffic-charts-grid">
            <Card>
              <CardHeader><CardTitle className="text-sm">요청 수 추이</CardTitle></CardHeader>
              <CardContent>
                <HitMissBarChart
                  labels={data.timeseries.labels}
                  hits={data.timeseries.hits}
                  misses={data.timeseries.misses}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">대역폭 &amp; 응답 시간</CardTitle></CardHeader>
              <CardContent>
                <BandwidthResponseChart
                  labels={data.timeseries.labels}
                  bandwidth={data.timeseries.bandwidth}
                  responseTime={data.timeseries.responseTime}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
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
          <span className="inline-block w-2 h-2 rounded-sm bg-success" />
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
              className="flex-1 h-full flex flex-col justify-end group relative"
              title={`${label}: HIT ${hits[i]}, MISS ${misses[i]}`}
            >
              <div
                className="w-full rounded-sm overflow-hidden"
                style={{ height: `${heightPct}%`, minHeight: total > 0 ? 2 : 0 }}
              >
                {/* MISS (위) */}
                <div className="w-full bg-destructive/70" style={{ height: `${missPct}%` }} />
                {/* HIT (아래) */}
                <div className="w-full bg-success/70" style={{ height: `${hitPct}%` }} />
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
        <MiniAreaChart values={bandwidth} maxValue={maxBw} color="var(--color-primary)" formatValue={formatBytes} />
      </div>

      {/* 응답 시간 에어리어 */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">응답 시간</p>
        <MiniAreaChart values={responseTime} maxValue={maxRt} color="var(--color-primary)" formatValue={(v) => `${v}ms`} />
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
