/// 도메인 로그 탭 — 기간 토글 + 자동갱신 드롭다운 + 수동 새로고침 + Top URL + 로그 테이블.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PeriodSelector, type PeriodValue } from './PeriodSelector';
import { RefreshIntervalSelect, type RefreshIntervalMs } from './RefreshIntervalSelect';
import { ManualRefreshButton } from './ManualRefreshButton';
import { DomainTopUrlsCard } from './DomainTopUrlsCard';
import { DomainLogTable } from './DomainLogTable';

interface Props {
  host: string;
}

export function DomainLogsTab({ host }: Props) {
  /** 조회 기간 상태 — 기본 24시간 */
  const [period, setPeriod] = useState<PeriodValue>({ period: '24h' });
  /** 자동 갱신 주기 — 기본 30초 */
  const [refresh, setRefresh] = useState<RefreshIntervalMs>(30_000);
  const qc = useQueryClient();

  /** custom 기간일 때만 from/to 범위 추출 */
  const range =
    period.period === 'custom' && period.from !== undefined && period.to !== undefined
      ? { from: period.from, to: period.to }
      : undefined;

  /** 수동 새로고침 — logs와 top-urls 쿼리 모두 무효화 */
  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['domain', host, 'logs'] });
    qc.invalidateQueries({ queryKey: ['domain', host, 'top-urls'] });
  }

  return (
    <div className="space-y-6" data-testid="domain-logs-tab">
      {/* 기간 선택 + 자동갱신 + 수동 새로고침 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <div className="flex items-center gap-2">
          <RefreshIntervalSelect value={refresh} onChange={setRefresh} />
          <ManualRefreshButton onClick={handleRefresh} />
        </div>
      </div>

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
