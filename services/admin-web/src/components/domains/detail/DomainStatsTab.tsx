/// 도메인 통계 탭 — 기간 토글 + 수동 새로고침. 캐시/최적화 2섹션.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { PeriodSelector, type PeriodValue } from './PeriodSelector';
import { ManualRefreshButton } from './ManualRefreshButton';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { DomainCacheCards } from './DomainCacheCards';
import { DomainStackedChart } from './DomainStackedChart';
import { DomainOptimizationStats } from './DomainOptimizationStats';
import { DomainTextCompressStats } from './DomainTextCompressStats';
import { DomainUrlOptimizationTable } from './DomainUrlOptimizationTable';

interface Props {
  host: string;
}

/** PeriodValue → DomainCacheCards/DomainStackedChart 가 기대하는 '1h'|'24h' 로 축약.
 *  7d/30d/custom 인 경우엔 24h 로 degrade (시계열 해상도 제한). */
function toSeriesRange(p: PeriodValue): '1h' | '24h' {
  return p.period === '1h' ? '1h' : '24h';
}

/** 선택 기간이 시계열 API 지원 범위(1h/24h)를 초과하는지 확인.
 *  true이면 캐시 섹션에 24h degrade 안내를 표시한다. */
function isSeriesDegraded(p: PeriodValue): boolean {
  return p.period !== '1h' && p.period !== '24h';
}

export function DomainStatsTab({ host }: Props) {
  const [period, setPeriod] = useState<PeriodValue>({ period: '24h' });
  const qc = useQueryClient();

  /** 수동 새로고침 — 이 도메인과 연관된 모든 쿼리 무효화 */
  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['domain', host] });
  }

  return (
    <div className="space-y-6" data-testid="domain-optimization-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <ManualRefreshButton onClick={handleRefresh} />
      </div>

      {/* 캐시 섹션 */}
      <Card data-testid="stats-cache-section">
        <CardHeader><CardTitle className="text-base font-semibold">캐시</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* 7d/30d/custom 선택 시 시계열 API가 24h 해상도만 지원함을 안내 (#51) */}
          {isSeriesDegraded(period) && (
            <div
              className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
              data-testid="cache-series-degrade-notice"
            >
              <Info size={14} className="shrink-0" />
              <span>시계열 차트와 캐시 카드는 24시간 해상도로 표시됩니다.</span>
            </div>
          )}
          <DomainCacheCards host={host} range={toSeriesRange(period)} />
          <DomainStackedChart host={host} range={toSeriesRange(period)} />
        </CardContent>
      </Card>

      {/* 텍스트 압축 섹션 (Phase 16-3) */}
      <DomainTextCompressStats host={host} />

      {/* 최적화 섹션 */}
      <Card data-testid="stats-optimization-section">
        <CardHeader>
          <CardTitle className="text-base font-semibold">최적화</CardTitle>
          <p className="text-sm text-muted-foreground">도메인 생성 이후 전체 누적</p>
        </CardHeader>
        <CardContent>
          <DomainOptimizationStats host={host} />
        </CardContent>
      </Card>

      {/* URL별 최적화 내역 (Phase 16-3) — period 'custom'은 24h 로 fallback */}
      <DomainUrlOptimizationTable
        host={host}
        period={period.period === 'custom' ? '24h' : period.period}
      />
    </div>
  );
}
