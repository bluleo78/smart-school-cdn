/// 도메인 통계 탭 — 기간 토글 + 수동 새로고침. 캐시/최적화 2섹션.
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
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
  /** 조회 기간 — 부모(DomainDetailTabs)에서 관리하여 탭 전환 시에도 값이 유지된다 (#135) */
  period: PeriodValue;
  onPeriodChange: (v: PeriodValue) => void;
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

export function DomainStatsTab({ host, period, onPeriodChange }: Props) {
  const qc = useQueryClient();

  /**
   * 이 도메인과 연관된 쿼리 중 하나라도 fetching 중이면 true.
   * useIsFetching으로 집계하여 ManualRefreshButton.isRefreshing에 전달 — 중복 클릭 방지 (#144).
   */
  const isFetching = useIsFetching({ queryKey: ['domain', host] }) > 0;

  /** 수동 새로고침 — 이 도메인과 연관된 모든 쿼리 무효화 */
  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['domain', host] });
  }

  // 'custom' 기간은 stats API 미지원 → 텍스트 압축/URL별 최적화도 24h로 silent fallback 되었음 (#226).
  // 어느 섹션이든 24h로 폴백되는 상태이면 상단에 한 번에 안내한다.
  const degraded = isSeriesDegraded(period);
  const isCustom = period.period === 'custom';
  // 텍스트 압축/URL 최적화 섹션에 실제로 전달되는 표시 기간 (custom은 24h로 폴백).
  const effectiveStatsPeriod: '1h' | '24h' | '7d' | '30d' = isCustom ? '24h' : period.period;

  return (
    <div className="space-y-6" data-testid="domain-optimization-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={onPeriodChange} />
        <ManualRefreshButton onClick={handleRefresh} isRefreshing={isFetching} />
      </div>

      {/* 7d/30d/custom 선택 시 stats/시계열 API가 24h 해상도만 지원함을 통합 안내 (#51, #226).
          기존엔 캐시 섹션 안에만 안내가 있어 텍스트 압축/URL 최적화 폴백 사실이 누락됐음. */}
      {degraded && (
        <div
          className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
          data-testid="cache-series-degrade-notice"
        >
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            {isCustom
              ? '커스텀 범위는 미지원 — 시계열 차트, 캐시 카드, 텍스트 압축, URL별 최적화 내역은 24시간 데이터로 표시됩니다.'
              : '시계열 차트, 캐시 카드, 텍스트 압축, URL별 최적화 내역은 24시간 해상도로 표시됩니다.'}
          </span>
        </div>
      )}

      {/* 캐시 섹션 */}
      <Card data-testid="stats-cache-section">
        <CardHeader><CardTitle className="text-base font-semibold">캐시</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <DomainCacheCards host={host} range={toSeriesRange(period)} />
          <DomainStackedChart host={host} range={toSeriesRange(period)} />
        </CardContent>
      </Card>

      {/* 텍스트 압축 섹션 (Phase 16-3) — period를 전달하여 PeriodSelector 연동 (#53 수정).
          'custom'은 24h로 폴백되며, 폴백 사실은 상단 통합 안내 배너로 노출 (#226). */}
      <DomainTextCompressStats host={host} period={effectiveStatsPeriod} />

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

      {/* URL별 최적화 내역 (Phase 16-3) — period 'custom'은 24h로 fallback (#226 안내 배너 참조).
          isCustomFallback 플래그로 카드 부제에 폴백 명시. */}
      <DomainUrlOptimizationTable
        host={host}
        period={effectiveStatsPeriod}
        isCustomFallback={isCustom}
      />
    </div>
  );
}
