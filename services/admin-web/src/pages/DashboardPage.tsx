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
    <div>
      <h2 className="text-2xl font-bold mb-4">대시보드</h2>

      {/* 1행: 4열 요약 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <ProxyStatusCard />
        <CacheHitRateCard />
        <BandwidthSavedCard />
        <EntryCountCard />
      </div>

      {/* 2행: 히트율 차트 (2/3) + 스토리지 사용량 (1/3) */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="col-span-2">
          <CacheHitRateChart />
        </div>
        <div className="col-span-1">
          <StorageUsageCard />
        </div>
      </div>

      {/* 3행: 요청 로그 테이블 */}
      <RequestLogTable />
    </div>
  );
}
