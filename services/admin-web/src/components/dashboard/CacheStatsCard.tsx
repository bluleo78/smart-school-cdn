/// 캐시 통계 카드 — 총 항목 수, 총 사용량, 히트율 표시 + 전체 캐시 퍼지
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
        <CardHeader><CardTitle>캐시 통계</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>캐시 통계</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">데이터 로드 실패</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card variant="glass">
        <CardHeader><CardTitle>캐시 통계</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* 총 캐시 항목 수 */}
          <div>
            <p className="text-xl font-bold leading-tight">
              {(data?.entry_count ?? 0).toLocaleString()}건
            </p>
            <p className="text-xs text-muted-foreground">총 캐시 항목</p>
          </div>
          {/* 총 사용량 */}
          <div>
            <p className="text-lg font-semibold leading-tight">
              {formatBytes(data?.total_size_bytes ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">총 사용량</p>
          </div>
          {/* 히트율 */}
          <div>
            <p className="text-lg font-semibold leading-tight">
              {((data?.hit_rate ?? 0) * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">히트율</p>
          </div>
          {/* 전체 퍼지 버튼 */}
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
