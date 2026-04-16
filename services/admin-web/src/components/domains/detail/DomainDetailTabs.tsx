/** 도메인 상세 탭 컨테이너
 * - overview: 개요
 * - stats: 통계
 * - settings: 설정
 */
import type { Domain } from '../../../api/domain-types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import { DomainOverviewTab } from './DomainOverviewTab';
import { DomainStatsTab } from './DomainStatsTab';
import { DomainSettingsTab } from './DomainSettingsTab';

interface Props {
  domain: Domain;
}

export function DomainDetailTabs({ domain }: Props) {
  return (
    <Tabs defaultValue="overview" data-testid="domain-detail-tabs">
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="stats">통계</TabsTrigger>
        <TabsTrigger value="settings">설정</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <DomainOverviewTab domain={domain} />
      </TabsContent>

      <TabsContent value="stats">
        <DomainStatsTab host={domain.host} />
      </TabsContent>

      <TabsContent value="settings">
        <DomainSettingsTab domain={domain} />
      </TabsContent>
    </Tabs>
  );
}
