/// 도메인 상세 탭 — Overview / Optimizer / Traffic / Settings.
/// URL searchParam(?tab=...)과 탭 상태를 동기화하여 뒤로가기/북마크/공유 링크가 올바른 탭을 유지한다.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import type { Domain } from '../../../api/domain-types';
import { DomainOverviewTab } from './DomainOverviewTab';
import { DomainStatsTab } from './DomainStatsTab';
import { DomainLogsTab } from './DomainLogsTab';
import { DomainSettingsTab } from './DomainSettingsTab';
import type { Period, PeriodValue } from './PeriodSelector';
import type { RefreshIntervalMs } from './RefreshIntervalSelect';

/** 허용된 탭 값 목록 — 잘못된 파라미터가 들어올 경우 overview로 폴백한다.
 *  value 식별자가 UI 레이블과 일치하도록 stats→optimizer, logs→traffic 으로 변경 (#64) */
const VALID_TABS = ['overview', 'optimizer', 'traffic', 'settings'] as const;
type TabValue = (typeof VALID_TABS)[number];

/** PeriodSelector가 허용하는 period 키 화이트리스트 — 잘못된 URL 파라미터를 방어 */
const VALID_PERIODS = ['1h', '24h', '7d', '30d', 'custom'] as const;

function isValidTab(value: string | null): value is TabValue {
  return VALID_TABS.includes(value as TabValue);
}

function isValidPeriod(value: string | null): value is Period {
  return VALID_PERIODS.includes(value as Period);
}

/** URL searchParams에서 PeriodValue를 복원한다.
 *  탭별 prefix(`op` / `tf`)를 사용해 최적화/트래픽 탭의 period 가 충돌하지 않도록 분리.
 *  custom 기간일 때 from/to 도 함께 읽어 새로고침 후에도 동일 범위 유지. */
function readPeriod(params: URLSearchParams, prefix: 'op' | 'tf'): PeriodValue {
  const period = params.get(`${prefix}Period`);
  if (!isValidPeriod(period)) return { period: '24h' };
  if (period !== 'custom') return { period };
  // custom: from/to 미입력 상태(커스텀 버튼만 클릭한 직후)도 그대로 표현 — pressed 표시 유지
  const fromRaw = params.get(`${prefix}From`);
  const toRaw = params.get(`${prefix}To`);
  if (fromRaw === null || toRaw === null) return { period: 'custom' };
  const from = Number(fromRaw);
  const to = Number(toRaw);
  // 잘못된 from/to 가 들어 있으면 from/to 없는 custom 상태로 폴백 (NaN이 API에 흘러가지 않게)
  if (!isFinite(from) || !isFinite(to) || from <= 0 || to <= from) return { period: 'custom' };
  return { period: 'custom', from, to };
}

interface Props {
  domain: Domain;
}

export function DomainDetailTabs({ domain }: Props) {
  // URL searchParam ?tab=... 으로 탭 상태를 영속화한다.
  // 뒤로가기·북마크·공유 링크로 특정 탭에 직접 접근할 수 있게 한다.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isValidTab(tabParam) ? tabParam : 'overview';

  // 최적화·트래픽 탭의 조회 기간·갱신 주기 상태를 URL searchParam과 동기화한다.
  // 새로고침/뒤로가기/북마크/공유 링크로도 동일한 기간/갱신 주기로 복원되도록 한다. (#206)
  // 탭별로 prefix(op/tf)를 분리해 두 탭의 period가 서로 덮어쓰지 않게 한다.
  const optimizerPeriod = readPeriod(searchParams, 'op');
  const trafficPeriod = readPeriod(searchParams, 'tf');
  // tfRefresh / opRefresh 키 — 미존재 시 기본 30초. 존재 시 허용된 RefreshIntervalMs 값만 채택, 그 외 30초 폴백.
  // 탭별로 분리하여 트래픽/최적화 자동 갱신 주기를 독립적으로 제어할 수 있게 한다 (#273).
  const ALLOWED_REFRESH = [0, 10_000, 30_000, 60_000, 300_000] as const;
  function readRefresh(key: string): RefreshIntervalMs {
    const raw = searchParams.get(key);
    const num = raw === null ? 30_000 : Number(raw);
    return (ALLOWED_REFRESH as readonly number[]).includes(num) ? (num as RefreshIntervalMs) : 30_000;
  }
  const trafficRefresh = readRefresh('tfRefresh');
  const optimizerRefresh = readRefresh('opRefresh');

  /** 탭 전환 시 ?tab=<value> 를 URL에 반영한다.
   *  함수형 업데이트로 기존 period/refresh 파라미터를 보존한다. (#206) */
  function handleTabChange(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', value);
        return next;
      },
      { replace: false },
    );
  }

  /** PeriodValue 변경을 URL에 반영한다.
   *  custom일 때만 from/to 키를 같이 쓰고, 그 외에는 제거해 URL을 간결하게 유지. */
  const writePeriod = useCallback(
    (prefix: 'op' | 'tf', value: PeriodValue) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(`${prefix}Period`, value.period);
          if (value.period === 'custom' && value.from && value.to) {
            next.set(`${prefix}From`, String(value.from));
            next.set(`${prefix}To`, String(value.to));
          } else {
            next.delete(`${prefix}From`);
            next.delete(`${prefix}To`);
          }
          return next;
        },
        // period 변경은 같은 화면 내 필터 조정이므로 history 엔트리 누적을 막기 위해 replace 사용
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleOptimizerPeriodChange = useCallback((v: PeriodValue) => writePeriod('op', v), [writePeriod]);
  const handleTrafficPeriodChange = useCallback((v: PeriodValue) => writePeriod('tf', v), [writePeriod]);

  /** 갱신 주기 변경을 URL에 반영. 기본값(30초)이면 키를 제거해 URL을 깔끔하게 유지.
   *  prefix(tf/op)별로 분리된 키를 사용해 트래픽/최적화 탭이 서로 덮어쓰지 않도록 한다 (#273). */
  const writeRefresh = useCallback(
    (key: 'tfRefresh' | 'opRefresh', v: RefreshIntervalMs) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 30_000) next.delete(key);
          else next.set(key, String(v));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const handleTrafficRefreshChange = useCallback(
    (v: RefreshIntervalMs) => writeRefresh('tfRefresh', v),
    [writeRefresh],
  );
  const handleOptimizerRefreshChange = useCallback(
    (v: RefreshIntervalMs) => writeRefresh('opRefresh', v),
    [writeRefresh],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full" data-testid="domain-detail-tabs">
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="optimizer">최적화</TabsTrigger>
        <TabsTrigger value="traffic">트래픽</TabsTrigger>
        <TabsTrigger value="settings">설정</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        <DomainOverviewTab domain={domain} />
      </TabsContent>
      <TabsContent value="optimizer" className="mt-4">
        <DomainStatsTab
          host={domain.host}
          period={optimizerPeriod}
          onPeriodChange={handleOptimizerPeriodChange}
          refresh={optimizerRefresh}
          onRefreshChange={handleOptimizerRefreshChange}
        />
      </TabsContent>
      <TabsContent value="traffic" className="mt-4">
        <DomainLogsTab
          host={domain.host}
          period={trafficPeriod}
          onPeriodChange={handleTrafficPeriodChange}
          refresh={trafficRefresh}
          onRefreshChange={handleTrafficRefreshChange}
        />
      </TabsContent>
      <TabsContent value="settings" className="mt-4">
        <DomainSettingsTab domain={domain} />
      </TabsContent>
    </Tabs>
  );
}
