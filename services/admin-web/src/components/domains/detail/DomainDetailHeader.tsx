/** 도메인 상세 페이지 헤더
 * - 왼쪽: 목록으로 돌아가기 링크 + 도메인명 + 활성 상태 배지
 * - 오른쪽: 캐시 퍼지 / 활성화 토글 / 삭제 액션 버튼
 */
import { useNavigate, Link } from 'react-router';
import { ChevronLeft, Trash2, RefreshCw, Power } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain } from '../../../api/domain-types';
import { usePurgeDomain } from '../../../hooks/usePurgeDomain';
import { useToggleDomain } from '../../../hooks/useToggleDomain';
import { useDeleteDomain } from '../../../hooks/useDeleteDomain';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { useState } from 'react';

interface Props {
  domain: Domain;
}

export function DomainDetailHeader({ domain }: Props) {
  const navigate = useNavigate();
  const purgeDomain = usePurgeDomain();
  const toggleDomain = useToggleDomain();
  const deleteDomain = useDeleteDomain();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isEnabled = domain.enabled === 1;
  // 비활성 도메인 가드 — DomainQuickActions(#203)와 동일한 안내 문구를 재사용해
  // 헤더/빠른 액션 카드 간 일관성을 유지한다 (#230)
  const isInactive = !isEnabled;
  const inactiveTitle = '비활성 도메인입니다. 활성화 후 사용 가능합니다.';
  // 헤더 퍼지 버튼은 의도치 않은 즉시 실행을 막기 위해 확인 다이얼로그를 거친다 (#230)
  const [showPurgeDialog, setShowPurgeDialog] = useState(false);

  /** 캐시 퍼지 처리
   * mutateAsync는 onError 콜백 실행 후에도 에러를 re-throw하므로
   * try-catch로 Unhandled Promise Rejection을 방지한다 */
  async function handlePurgeConfirm() {
    try {
      await purgeDomain.mutateAsync(domain.host);
      setShowPurgeDialog(false);
    } catch {
      // 에러는 usePurgeDomain의 onError toast가 이미 처리함 — 다이얼로그는 유지해 재시도 허용
    }
  }

  /** 활성/비활성 토글 처리
   * mutateAsync는 onError 콜백 실행 후에도 에러를 re-throw하므로
   * try-catch로 Unhandled Promise Rejection을 방지한다 */
  async function handleToggle() {
    try {
      await toggleDomain.mutateAsync(domain.host);
    } catch {
      // 에러는 useToggleDomain의 onError toast가 이미 처리함
    }
  }

  /** 삭제 확인 후 목록으로 이동 */
  async function handleDeleteConfirm() {
    try {
      await deleteDomain.mutateAsync(domain.host);
      toast.success(`${domain.host} 도메인이 삭제되었습니다.`);
      void navigate('/domains');
    } catch {
      toast.error('도메인 삭제에 실패했습니다.');
    }
    setShowDeleteDialog(false);
  }

  return (
    <div
      className="flex items-center justify-between pb-4 border-b border-border"
      data-testid="domain-detail-header"
    >
      {/* 왼쪽: 뒤로가기 + 도메인명 + 상태 배지 */}
      <div className="flex flex-col gap-1">
        <Link
          to="/domains"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          data-testid="domain-detail-back-link"
        >
          <ChevronLeft size={14} />
          도메인 목록
        </Link>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight font-mono">
            {domain.host}
          </h2>
          <Badge variant={isEnabled ? 'success' : 'outline'}>
            {isEnabled ? '활성' : '비활성'}
          </Badge>
        </div>
        {domain.description && (
          <p className="text-sm text-muted-foreground">{domain.description}</p>
        )}
      </div>

      {/* 오른쪽: 액션 버튼 */}
      <div className="flex items-center gap-2">
        {/* 캐시 퍼지 — 비활성 도메인에서는 disabled + 안내(#230) */}
        <Button
          variant="default"
          onClick={() => setShowPurgeDialog(true)}
          disabled={purgeDomain.isPending || isInactive}
          title={isInactive ? inactiveTitle : undefined}
          data-testid="domain-purge-button"
        >
          <RefreshCw size={14} className={purgeDomain.isPending ? 'animate-spin' : ''} />
          {purgeDomain.isPending ? '퍼지 중…' : '캐시 퍼지'}
        </Button>

        {/* 활성화/비활성화 토글 */}
        <Button
          variant="outline"
          onClick={handleToggle}
          disabled={toggleDomain.isPending}
          className={isEnabled
            ? "border-warning/50 text-warning hover:bg-warning/10"    // 활성 도메인 → 비활성화 버튼: warning 색
            : "border-success/50 text-success hover:bg-success/10"     // 비활성 도메인 → 활성화 버튼: success 색
          }
          data-testid="domain-toggle-button"
        >
          <Power size={14} />
          {toggleDomain.isPending ? '처리 중…' : isEnabled ? '비활성화' : '활성화'}
        </Button>

        {/* 삭제 */}
        <Button
          variant="destructive"
          onClick={() => setShowDeleteDialog(true)}
          data-testid="domain-delete-button"
        >
          <Trash2 size={14} />
          삭제
        </Button>
      </div>

      {/* 캐시 퍼지 확인 AlertDialog — 헤더 버튼이 즉시 실행되던 회귀 방지 (#230)
          DomainQuickActions의 PurgeConfirmDialog와 동일 패턴: isPending 중에는 닫기 차단 */}
      <AlertDialog
        open={showPurgeDialog}
        onClose={() => { if (!purgeDomain.isPending) setShowPurgeDialog(false); }}
      >
        <AlertDialogContent
          className="max-w-sm"
          data-testid="domain-header-purge-dialog"
          disableClose={purgeDomain.isPending}
        >
          <AlertDialogTitle>캐시 퍼지</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium">{domain.host}</span>의 전체 캐시를 삭제합니다. 계속하시겠습니까?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowPurgeDialog(false)}
              disabled={purgeDomain.isPending}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handlePurgeConfirm}
              disabled={purgeDomain.isPending}
              data-testid="domain-header-purge-confirm"
            >
              {purgeDomain.isPending ? '퍼지 중…' : '퍼지'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* 삭제 확인 AlertDialog — 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={showDeleteDialog} onClose={() => { if (!deleteDomain.isPending) setShowDeleteDialog(false); }}>
        <AlertDialogContent className="max-w-sm" data-testid="domain-delete-dialog" disableClose={deleteDomain.isPending}>
          <AlertDialogTitle>도메인 삭제</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium">{domain.host}</span>을(를) 삭제하시겠습니까?
            DNS 오버라이드와 캐시가 함께 해제됩니다.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteDomain.isPending}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteDomain.isPending}
              data-testid="domain-delete-confirm"
            >
              {deleteDomain.isPending ? '삭제 중…' : '삭제'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
