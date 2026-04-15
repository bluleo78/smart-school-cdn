/** 도메인 상세 탭 컨테이너
 * - overview: 개요 (기본)
 * - stats: 통계
 * - settings: 설정
 * 각 탭 내용은 추후 구현 예정 — 현재는 플레이스홀더
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';

export function DomainDetailTabs() {
  return (
    <Tabs defaultValue="overview" data-testid="domain-detail-tabs">
      <TabsList>
        <TabsTrigger value="overview">개요</TabsTrigger>
        <TabsTrigger value="stats">통계</TabsTrigger>
        <TabsTrigger value="settings">설정</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        {/* 개요 탭 — Task 12에서 구현 예정 */}
        <div data-testid="domain-overview-tab">Overview 탭 (구현 예정)</div>
      </TabsContent>

      <TabsContent value="stats">
        {/* 통계 탭 — Task 13에서 구현 예정 */}
        <div data-testid="domain-stats-tab">통계 탭 (구현 예정)</div>
      </TabsContent>

      <TabsContent value="settings">
        {/* 설정 탭 — Task 14에서 구현 예정 */}
        <div data-testid="domain-settings-tab">설정 탭 (구현 예정)</div>
      </TabsContent>
    </Tabs>
  );
}
