/// 도메인 상세 탭 — Overview / Stats / Logs / Settings.
/// URL searchParam(?tab=...)과 탭 상태를 동기화하여 뒤로가기/북마크/공유 링크가 올바른 탭을 유지한다.
import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import type { Domain } from '../../../api/domain-types';
import { DomainOverviewTab } from './DomainOverviewTab';
import { DomainStatsTab } from './DomainStatsTab';
import { DomainLogsTab } from './DomainLogsTab';
import { DomainSettingsTab } from './DomainSettingsTab';

/** 허용된 탭 값 목록 — 잘못된 파라미터가 들어올 경우 overview로 폴백한다 */
const VALID_TABS = ['overview', 'stats', 'logs', 'settings'] as const;
type TabValue = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TabValue {
  return VALID_TABS.includes(value as TabValue);
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

  /** 탭 전환 시 ?tab=<value> 를 URL에 반영한다 */
  function handleTabChange(value: string) {
    setSearchParams({ tab: value }, { replace: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full" data-testid="domain-detail-tabs">
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="stats">최적화</TabsTrigger>
        <TabsTrigger value="logs">트래픽</TabsTrigger>
        <TabsTrigger value="settings">설정</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        <DomainOverviewTab domain={domain} />
      </TabsContent>
      <TabsContent value="stats" className="mt-4">
        <DomainStatsTab host={domain.host} />
      </TabsContent>
      <TabsContent value="logs" className="mt-4">
        <DomainLogsTab host={domain.host} />
      </TabsContent>
      <TabsContent value="settings" className="mt-4">
        <DomainSettingsTab domain={domain} />
      </TabsContent>
    </Tabs>
  );
}
