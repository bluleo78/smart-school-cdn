/// 대시보드 페이지 — 캐시 재설계 후 L1 중심 레이아웃.
/// 상단: 주요 메트릭 4카드(프록시/L1/엣지/BYPASS) → 스택 차트 + 디스크 → 세부 카드 3개
/// → 도메인별 표 + 인기 콘텐츠 → 요청 로그 → 위험 구역(전체 퍼지) 순으로 드릴다운.
import { useState } from 'react';
import { toast } from 'sonner';
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
import { usePurgeCache } from '../hooks/usePurgeCache';
import { formatBytes } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';

export function DashboardPage() {
  const { mutateAsync: purge, isPending } = usePurgeCache();
  const [showConfirm, setShowConfirm] = useState(false);

  /** 전체 퍼지 실행 — 운영자가 캐시를 긴급 초기화할 때 사용 */
  async function handlePurge() {
    try {
      const result = await purge({ type: 'all' });
      toast.success(`캐시 ${result.purged_count}건 퍼지 완료 (${formatBytes(result.freed_bytes)} 해제)`);
    } catch {
      toast.error('캐시 퍼지 실패');
    } finally {
      setShowConfirm(false);
    }
  }

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

      {/* 2행: 스택 차트(2/3) + 디스크(1/3) — items-start로 각 셀이 자체 콘텐츠 높이만큼만 차지하도록 제한 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
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

      {/* 위험 구역 — 파괴적 전역 액션을 읽기 전용 카드와 분리하여 페이지 하단에 배치 */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">위험 구역</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">전체 캐시 퍼지</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              모든 캐시를 즉시 삭제합니다. 되돌릴 수 없습니다.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => setShowConfirm(true)}
            data-testid="purge-all-btn"
          >
            전체 캐시 퍼지
          </Button>
        </CardContent>
      </Card>

      {/* 퍼지 확인 AlertDialog */}
      <AlertDialog open={showConfirm} onClose={() => setShowConfirm(false)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogTitle>전체 캐시 퍼지</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            전체 캐시를 삭제합니다. 계속하시겠습니까?
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              취소
            </Button>
            <Button variant="destructive" disabled={isPending} onClick={handlePurge}>
              {isPending ? '퍼지 중…' : '퍼지 실행'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
