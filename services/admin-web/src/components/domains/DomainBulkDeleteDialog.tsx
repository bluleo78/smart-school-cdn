/// 도메인 일괄 삭제 확인 다이얼로그
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { useBulkDeleteDomains } from '../../hooks/useBulkDeleteDomains';

interface DomainBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hosts: string[];
  onSuccess: () => void;
}

export function DomainBulkDeleteDialog({
  open,
  onOpenChange,
  hosts,
  onSuccess,
}: DomainBulkDeleteDialogProps) {
  const bulkDelete = useBulkDeleteDomains();

  async function handleConfirm() {
    try {
      await bulkDelete.mutateAsync(hosts);
      onSuccess();
      onOpenChange(false);
    } catch {
      // 오류 토스트는 훅에서 처리
    }
  }

  /** 삭제 진행 중에는 닫기 요청(ESC/백드롭/X/취소)을 모두 무시한다 (#163) */
  const handleClose = () => { if (!bulkDelete.isPending) onOpenChange(false); };

  return (
    <AlertDialog open={open} onClose={handleClose}>
      <AlertDialogContent className="max-w-sm" data-testid="bulk-delete-dialog" disableClose={bulkDelete.isPending}>
        <AlertDialogTitle>도메인 일괄 삭제</AlertDialogTitle>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{hosts.length}개</span> 도메인을 삭제하시겠습니까?
          DNS 오버라이드와 캐시가 함께 해제됩니다.
        </p>
        {/* 삭제 대상 호스트 목록 */}
        {hosts.length > 0 && (
          <ul className="max-h-36 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 space-y-0.5">
            {hosts.map((h) => (
              <li key={h} className="font-mono text-xs text-muted-foreground">
                {h}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={handleClose} disabled={bulkDelete.isPending}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={bulkDelete.isPending}
            data-testid="bulk-delete-confirm"
          >
            {bulkDelete.isPending ? '삭제 중…' : '삭제'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
