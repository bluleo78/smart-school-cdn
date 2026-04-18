/// BYPASS 사유 세부 카드 — BYPASS 4분류(METHOD/NOCACHE/SIZE/OTHER)를 나눠 보여주고
/// 운영자가 원인별로 정책을 튜닝할 수 있도록 돕는다. 재설계 이전엔 총 항목/용량/히트율을
/// 담았으나, 해당 지표는 EntryCount/StorageUsage/CacheHitRate 카드가 전담하므로
/// 이 슬롯은 BYPASS 상세로 재배치했다. 전체 퍼지 버튼은 유지한다.
import { useState } from 'react';
import { toast } from 'sonner';
import { useCacheStats } from '../../hooks/useCacheStats';
import { usePurgeCache } from '../../hooks/usePurgeCache';
import { formatBytes } from '../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../ui/alert-dialog';

export function CacheStatsCard() {
  const { data, isLoading, error } = useCacheStats();
  const { mutateAsync: purge, isPending } = usePurgeCache();
  const [showConfirm, setShowConfirm] = useState(false);

  /** 전체 퍼지 실행 */
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

  if (isLoading) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">데이터 로드 실패</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card variant="glass" data-testid="cache-stats-card">
        <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* BYPASS 4분류 카운터 */}
          <div className="grid grid-cols-2 gap-2 text-sm" data-testid="bypass-breakdown">
            <div className="flex justify-between">
              <span className="text-muted-foreground">METHOD</span>
              <span className="font-mono tabular-nums">{data.bypass.method.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">NOCACHE</span>
              <span className="font-mono tabular-nums">{data.bypass.nocache.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">SIZE</span>
              <span className="font-mono tabular-nums">{data.bypass.size.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">OTHER</span>
              <span className="font-mono tabular-nums">{data.bypass.other.toLocaleString()}</span>
            </div>
          </div>
          {/* 총 BYPASS */}
          <div>
            <p className="text-lg font-semibold leading-tight tabular-nums">
              {data.bypass.total.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">총 BYPASS</p>
          </div>
          {/* 전체 퍼지 버튼 — 캐시 긴급 초기화용 */}
          <Button
            variant="destructive"
            className="mt-1 w-full"
            onClick={() => setShowConfirm(true)}
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
    </>
  );
}
