/// 도메인 상세 탭 — Overview / Stats / Logs / Settings.
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import type { Domain } from '../../../api/domain-types';
import { DomainOverviewTab } from './DomainOverviewTab';
import { DomainStatsTab } from './DomainStatsTab';
import { DomainLogsTab } from './DomainLogsTab';
import { DomainSettingsTab } from './DomainSettingsTab';

interface Props {
  domain: Domain;
}

export function DomainDetailTabs({ domain }: Props) {
  return (
    <Tabs defaultValue="overview" className="w-full" data-testid="domain-detail-tabs">
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
