/// 도메인 통계 탭 — 기간 토글 + 자동 갱신 드롭다운 + 수동 새로고침. 캐시/최적화 2섹션.
import { useEffect } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { BarChart2, Info } from 'lucide-react';
import { PeriodSelector, type PeriodValue } from './PeriodSelector';
import { RefreshIntervalSelect, type RefreshIntervalMs } from './RefreshIntervalSelect';
import { ManualRefreshButton } from './ManualRefreshButton';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { DomainCacheCards } from './DomainCacheCards';
import { DomainStackedChart } from './DomainStackedChart';
import { DomainOptimizationStats } from './DomainOptimizationStats';
import { DomainTextCompressStats } from './DomainTextCompressStats';
import { DomainUrlOptimizationTable } from './DomainUrlOptimizationTable';
import { useCacheSeries } from '../../../hooks/useCacheSeries';

interface Props {
  host: string;
  /** 조회 기간 — 부모(DomainDetailTabs)에서 관리하여 탭 전환 시에도 값이 유지된다 (#135) */
  period: PeriodValue;
  onPeriodChange: (v: PeriodValue) => void;
  /** 자동 갱신 주기 — 부모(DomainDetailTabs)에서 관리하여 탭 전환 시에도 값이 유지된다 (#273) */
  refresh: RefreshIntervalMs;
  onRefreshChange: (v: RefreshIntervalMs) => void;
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

export function DomainStatsTab({ host, period, onPeriodChange, refresh, onRefreshChange }: Props) {
  const qc = useQueryClient();

  /**
   * 이 도메인과 연관된 쿼리 중 하나라도 fetching 중이면 true.
   * useIsFetching으로 집계하여 ManualRefreshButton.isRefreshing에 전달 — 중복 클릭 방지 (#144).
   */
  const isFetching = useIsFetching({ queryKey: ['domain', host] }) > 0;

  /** 수동 새로고침 — 이 도메인과 연관된 모든 쿼리 + 캐시 시계열/전체 최적화 통계 무효화.
   *  최적화 탭이 사용하는 쿼리 키는 다음 4종류이므로 모두 무효화한다 (#273).
   *  - ['domain', host, ...]: text-compress-stats / url-optimization
   *  - ['cache', 'series', range, host]: 캐시 시계열 (DomainCacheCards / DomainStackedChart)
   *  - ['optimization', 'stats', host]: DomainOptimizationStats 누적 통계
   */
  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['domain', host] });
    qc.invalidateQueries({ queryKey: ['cache', 'series'] });
    qc.invalidateQueries({ queryKey: ['optimization', 'stats', host] });
  }

  /** 자동 갱신 — 트래픽 탭의 RefreshIntervalSelect 와 동일한 UX (#273).
   *  DomainLogsTab은 자식 훅에 refetchIntervalMs를 직접 전달하지만, 최적화 탭의 자식 훅들은
   *  refetchInterval이 하드코딩(10/30초)되어 있어 props로 주입하기 어렵다.
   *  따라서 부모에서 setInterval로 invalidate를 발사하는 방식으로 동일한 효과를 낸다.
   *  refresh === 0(Off)이면 setInterval을 만들지 않아 폴링이 멈춘다. */
  useEffect(() => {
    if (refresh === 0) return;
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ['domain', host] });
      qc.invalidateQueries({ queryKey: ['cache', 'series'] });
      qc.invalidateQueries({ queryKey: ['optimization', 'stats', host] });
    }, refresh);
    return () => window.clearInterval(id);
  }, [qc, host, refresh]);

  // 'custom' 기간은 stats API 미지원 → 텍스트 압축/URL별 최적화도 24h로 silent fallback 되었음 (#226).
  // 어느 섹션이든 24h로 폴백되는 상태이면 상단에 한 번에 안내한다.
  const degraded = isSeriesDegraded(period);
  const isCustom = period.period === 'custom';
  // 텍스트 압축/URL 최적화 섹션에 실제로 전달되는 표시 기간 (custom은 24h로 폴백).
  // isCustom 분기 후에도 TS가 period.period 유니온을 좁히지 못하므로(객체 프로퍼티 narrowing 한계)
  // 단언으로 'custom' 제외임을 명시. 분기 가드(isCustom)와 의미가 일치한다.
  const effectiveStatsPeriod: '1h' | '24h' | '7d' | '30d' = isCustom
    ? '24h'
    : (period.period as '1h' | '24h' | '7d' | '30d');

  // 캐시 섹션 통합 빈 상태 판정 (#267) —
  // DomainCacheCards / DomainStackedChart 두 자식이 동일 useCacheSeries(range, host) 키를 공유하므로
  // 부모에서 한 번 더 호출해도 TanStack Query가 dedupe → 추가 네트워크 비용 없음.
  // total === 0 또는 빈 버킷이면 자식 두 개를 모두 숨기고 단일 빈 상태 박스만 노출하여
  // "아직 데이터가 없습니다" 메시지가 한 카드 내에서 두 번 출력되던 중복 표시를 제거한다.
  const cacheRange = toSeriesRange(period);
  const { data: cacheBuckets, isLoading: cacheLoading, isError: cacheError } =
    useCacheSeries(cacheRange, host);
  const cacheTotal = (cacheBuckets ?? []).reduce(
    (a, b) => a + b.l1_hits + b.l2_hits + b.miss + b.bypass,
    0,
  );
  // 로딩/에러는 자식 컴포넌트 각자 처리 → 그 시점엔 자식이 자체 UI를 보여주므로 통합 빈 상태로 가지 않는다.
  const cacheIsEmpty =
    !cacheLoading && !cacheError && (!cacheBuckets || cacheBuckets.length === 0 || cacheTotal === 0);

  return (
    <div className="space-y-6" data-testid="domain-optimization-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={onPeriodChange} />
        {/* 트래픽 탭(DomainLogsTab)과 동일한 컨트롤 묶음 — 갱신 인디케이터 + 드롭다운 + 수동 ↻ (#273). */}
        <div className="flex items-center gap-2">
          <RefreshIntervalSelect value={refresh} onChange={onRefreshChange} />
          <ManualRefreshButton onClick={handleRefresh} isRefreshing={isFetching} />
        </div>
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

      {/* 캐시 섹션 — 데이터가 없을 때 두 자식이 각각 빈 상태를 출력해
          한 카드 안에서 동일 메시지가 중복 노출되던 문제를 부모에서 통합 처리 (#267). */}
      <Card data-testid="stats-cache-section">
        <CardHeader><CardTitle className="text-base font-semibold">캐시</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {cacheIsEmpty ? (
            // 통합 빈 상태 — DomainCacheCards / DomainStackedChart 의 빈 상태 UI를 한 번으로 합친다.
            // 컨테이너 스타일은 기존 DomainCacheCards 의 dashed 박스 패턴을 채택하여 카드 내 다른
            // 빈 상태(텍스트 압축 등)와 시각적 일관성을 유지한다.
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-muted-foreground"
              data-testid="stats-cache-empty"
            >
              <BarChart2 size={32} className="opacity-30" />
              <p className="text-sm">아직 데이터가 없습니다</p>
              <p className="text-xs">프록시로 요청이 들어오면 자동으로 표시됩니다</p>
            </div>
          ) : (
            <>
              <DomainCacheCards host={host} range={cacheRange} />
              <DomainStackedChart host={host} range={cacheRange} />
            </>
          )}
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
