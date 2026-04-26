/// 대시보드 페이지 — 캐시 재설계 후 L1 중심 레이아웃.
/// 상단: 주요 메트릭 4카드(프록시/L1/엣지/BYPASS) → 스택 차트 + 디스크 → 세부 카드 3개
/// → 도메인별 표 + 인기 콘텐츠 → 요청 로그 순으로 드릴다운.
import { ProxyStatusCard } from '../components/dashboard/ProxyStatusCard';
import { RequestLogTable } from '../components/dashboard/RequestLogTable';
import { CacheHitRateCard } from '../components/dashboard/CacheHitRateCard';
import { EdgeHitRateCard } from '../components/dashboard/EdgeHitRateCard';
import { BypassRateCard } from '../components/dashboard/BypassRateCard';
import { BandwidthSavedCard } from '../components/dashboard/BandwidthSavedCard';
import { StorageUsageCard } from '../components/dashboard/StorageUsageCard';
import { CacheHitRateChart } from '../components/dashboard/CacheHitRateChart';
import { EntryCountCard } from '../components/dashboard/EntryCountCard';
import { CacheStatsCard } from '../components/dashboard/CacheStatsCard';
import { ByDomainTable } from '../components/dashboard/ByDomainTable';
import { PopularContentCard } from '../components/dashboard/PopularContentCard';

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">대시보드</h2>
        <p className="text-sm text-muted-foreground mt-1">캐시 효과와 서비스 상태를 확인합니다.</p>
      </div>

      {/* 1행: 메트릭 카드 4개 — L1 히트율이 가장 중요 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ProxyStatusCard />
        <CacheHitRateCard />
        <EdgeHitRateCard />
        <BypassRateCard />
      </div>

      {/* 2행: 스택 차트(2/3) + 디스크(1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="lg:col-span-2 min-h-0">
          <CacheHitRateChart />
        </div>
        <div className="min-h-0">
          <StorageUsageCard />
        </div>
      </div>

      {/* 3행: 요청수 · 항목수 · BYPASS 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BandwidthSavedCard />
        <EntryCountCard />
        <CacheStatsCard />
      </div>

      {/* 4행: 도메인별 표 + 인기 콘텐츠 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ByDomainTable />
        <PopularContentCard />
      </div>

      {/* 5행: 요청 로그 */}
      <RequestLogTable />
    </div>
  );
}
