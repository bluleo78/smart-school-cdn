/// 위험 구역 카드 — 전체 캐시 퍼지 (이슈 #282).
/// 무엇을: 운영자가 캐시를 긴급 초기화하는 destructive 전역 액션.
/// 왜: DashboardPage 는 읽기 전용 모니터링 페이지이므로 비가역 액션은 /system 의 유지보수 영역에
///    배치한다. 정보 구조상 "운영/유지보수" 페이지에 묶여야 우발적 클릭 위험이 줄어든다.
import { useState } from 'react';
import { toast } from 'sonner';
import { usePurgeCache } from '../../hooks/usePurgeCache';
import { formatBytes } from '../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../ui/alert-dialog';

export function DangerZoneCard() {
  const { mutateAsync: purge, isPending } = usePurgeCache();
  const [showConfirm, setShowConfirm] = useState(false);

  /** 전체 퍼지 실행 — 운영자가 캐시를 긴급 초기화할 때 사용 */
  async function handlePurge() {
    try {
      const result = await purge({ type: 'all' });
      // purged_count === 0 이면 매칭된 캐시가 없다는 안내 토스트(info)로 분기 (#208).
      // gRPC uint64 → string 직렬화 경로 방어 (#208 회귀).
      const purgedCount = Number(result.purged_count);
      if (purgedCount === 0) {
        toast.info('퍼지할 캐시 항목이 없습니다.');
      } else {
        toast.success(`캐시 ${purgedCount}건 퍼지 완료 (${formatBytes(Number(result.freed_bytes))} 해제)`);
      }
    } catch {
      toast.error('캐시 퍼지에 실패했습니다.');
    } finally {
      setShowConfirm(false);
    }
  }

  return (
    <>
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

      {/* 퍼지 확인 AlertDialog — 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={showConfirm} onClose={() => { if (!isPending) setShowConfirm(false); }}>
        <AlertDialogContent className="max-w-sm" data-testid="purge-all-dialog" disableClose={isPending}>
          <AlertDialogTitle>전체 캐시 퍼지</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            전체 캐시를 삭제합니다. 계속하시겠습니까?
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isPending}>
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
