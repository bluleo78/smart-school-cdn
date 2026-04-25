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

  /** 캐시 퍼지 처리 */
  async function handlePurge() {
    await purgeDomain.mutateAsync(domain.host);
  }

  /** 활성/비활성 토글 처리 */
  async function handleToggle() {
    await toggleDomain.mutateAsync(domain.host);
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
        {/* 캐시 퍼지 */}
        <Button
          variant="default"
          onClick={handlePurge}
          disabled={purgeDomain.isPending}
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
          className="border-warning/50 text-warning hover:bg-warning/10"
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

      {/* 삭제 확인 AlertDialog */}
      <AlertDialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <AlertDialogContent className="max-w-sm" data-testid="domain-delete-dialog">
          <AlertDialogTitle>도메인 삭제</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium">{domain.host}</span>을(를) 삭제하시겠습니까?
            DNS 오버라이드와 캐시가 함께 해제됩니다.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
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
