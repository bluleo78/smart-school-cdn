/// 대시보드 페이지 v2 — 프록시 + 캐시 통합 모니터링
import { ProxyStatusCard } from '../components/dashboard/ProxyStatusCard';
import { RequestLogTable } from '../components/dashboard/RequestLogTable';
import { CacheHitRateCard } from '../components/dashboard/CacheHitRateCard';
import { BandwidthSavedCard } from '../components/dashboard/BandwidthSavedCard';
import { StorageUsageCard } from '../components/dashboard/StorageUsageCard';
import { CacheHitRateChart } from '../components/dashboard/CacheHitRateChart';
import { EntryCountCard } from '../components/dashboard/EntryCountCard';

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">대시보드</h2>
        <p className="text-sm text-muted-foreground mt-1">CDN 서비스 현황을 한눈에 확인합니다.</p>
      </div>

      {/* 1행: 요약 카드 — 글래스모피즘 그라디언트 배경 */}
      <div className="rounded-2xl bg-gradient-to-br from-glass-from via-glass-via to-glass-to p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ProxyStatusCard />
          <CacheHitRateCard />
          <BandwidthSavedCard />
          <EntryCountCard />
        </div>
      </div>

      {/* 2행: 히트율 차트(2/3) + 스토리지(1/3) — 모바일 1열, 데스크탑 3열 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CacheHitRateChart />
        </div>
        <div>
          <StorageUsageCard />
        </div>
      </div>

      {/* 3행: 요청 로그 */}
      <RequestLogTable />
    </div>
  );
}
