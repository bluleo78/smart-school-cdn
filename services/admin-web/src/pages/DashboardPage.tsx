/// 대시보드 페이지 — 프록시 상태 카드 + 최근 요청 로그 테이블
/// 5초 간격으로 API를 폴링하여 실시간 모니터링을 제공한다.
import { ProxyStatusCard } from '../components/dashboard/ProxyStatusCard';
import { RequestLogTable } from '../components/dashboard/RequestLogTable';

export function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">대시보드</h2>

      {/* 프록시 상태 카드 */}
      <div className="mb-6">
        <ProxyStatusCard />
      </div>

      {/* 최근 요청 로그 테이블 */}
      <RequestLogTable />
    </div>
  );
}
