/// 도메인 통계 탭 — 기간 토글 + 수동 새로고침. 캐시/최적화 2섹션.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PeriodSelector, type PeriodValue } from './PeriodSelector';
import { ManualRefreshButton } from './ManualRefreshButton';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { DomainCacheCards } from './DomainCacheCards';
import { DomainStackedChart } from './DomainStackedChart';
import { DomainOptimizationStats } from './DomainOptimizationStats';

interface Props {
  host: string;
}

/** PeriodValue → DomainCacheCards/DomainStackedChart 가 기대하는 '1h'|'24h' 로 축약.
 *  7d/30d/custom 인 경우엔 24h 로 degrade (시계열 해상도 제한). */
function toSeriesRange(p: PeriodValue): '1h' | '24h' {
  return p.period === '1h' ? '1h' : '24h';
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
          <DomainCacheCards host={host} range={toSeriesRange(period)} />
          <DomainStackedChart host={host} range={toSeriesRange(period)} />
        </CardContent>
      </Card>

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
    </div>
  );
}
