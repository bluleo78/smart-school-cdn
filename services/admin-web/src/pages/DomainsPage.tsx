/**
 * 도메인 관리 페이지 — 전면 교체
 * - 요약 카드, 경고 배너, 툴바, 테이블, 다이얼로그 서브 컴포넌트 조합
 * - 기존 사이드패널 + 프록시 테스트 제거
 * - 필터 상태를 useSearchParams로 관리하여 URL에 동기화 (#68)
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useDomains } from '../hooks/useDomains';
import { useAddDomain } from '../hooks/useAddDomain';
import { useDeleteDomain } from '../hooks/useDeleteDomain';
import { useToggleDomain } from '../hooks/useToggleDomain';
import { usePurgeDomain } from '../hooks/usePurgeDomain';
import type { DomainsFilter } from '../api/domain-types';
import { DomainSummaryCards } from '../components/domains/DomainSummaryCards';
import { DomainAlertBanner } from '../components/domains/DomainAlertBanner';
import { DomainToolbar } from '../components/domains/DomainToolbar';
import { DomainTable } from '../components/domains/DomainTable';
import { DomainBulkAddDialog } from '../components/domains/DomainBulkAddDialog';
import { DomainBulkDeleteDialog } from '../components/domains/DomainBulkDeleteDialog';

// ─── 도메인 추가 다이얼로그 ──────────────────────────────────────

function AddDomainDialog({ onClose }: { onClose: () => void }) {
  const [host, setHost] = useState('');
  const [origin, setOrigin] = useState('');
  // 필드별 개별 에러 상태 — 각 입력 필드 바로 아래에 인라인으로 표시하기 위해 분리
  const [hostError, setHostError] = useState<string | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  // 서버 오류 등 전역 에러(어느 필드에 귀속시키기 어려운 경우)
  const [submitError, setSubmitError] = useState<string | null>(null);
  const addDomain = useAddDomain();

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    // 제출 시 기존 에러 초기화
    setHostError(null);
    setOriginError(null);
    setSubmitError(null);

    const h = host.trim();
    const o = origin.trim();

    // 필드별 유효성 검사 — 오류를 해당 필드 에러 상태에 개별 반영
    let hasError = false;
    if (!h) {
      setHostError('도메인을 입력해주세요.');
      hasError = true;
    }
    if (!o) {
      setOriginError('원본 URL을 입력해주세요.');
      hasError = true;
    } else if (!o.startsWith('http://') && !o.startsWith('https://')) {
      setOriginError('원본 URL은 http:// 또는 https://로 시작해야 합니다.');
      hasError = true;
    }
    if (hasError) return;

    try {
      await addDomain.mutateAsync({ host: h, origin: o });
      toast.success(`${h} 도메인이 추가되었습니다.`);
      onClose();
    } catch {
      setSubmitError('도메인 추가에 실패했습니다.');
    }
  }

  return (
    <DialogContent data-testid="add-domain-dialog">
      <DialogTitle>도메인 추가</DialogTitle>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          {/* 필수 필드 라벨 — text-foreground + * 표시로 시각 위계 명확히 (이슈 #22) */}
          <label htmlFor="add-host" className="text-sm font-medium text-foreground">
            도메인 <span className="text-destructive" aria-hidden="true">*</span>
          </label>
          <Input
            id="add-host"
            value={host}
            onChange={(e) => { setHost(e.target.value); setHostError(null); }}
            placeholder="textbook.com 또는 *.textbook.com"
            data-testid="add-domain-host"
            // autoFocus 제거 — Radix DialogContent의 onOpenAutoFocus가 첫 포커스를 처리한다.
            // native autoFocus는 Radix FocusScope useEffect보다 먼저 실행되어
            // 트리거 버튼으로의 포커스 복귀(WCAG 2.4.3)를 깨뜨린다 (이슈 #29).
          />
          {/* 도메인 필드 인라인 에러 */}
          {hostError && (
            <p className="text-xs text-destructive" data-testid="add-domain-host-error">
              {hostError}
            </p>
          )}
        </div>
        <div className="space-y-1">
          {/* 필수 필드 라벨 — text-foreground + * 표시로 시각 위계 명확히 (이슈 #22) */}
          <label htmlFor="add-origin" className="text-sm font-medium text-foreground">
            원본 URL <span className="text-destructive" aria-hidden="true">*</span>
          </label>
          <Input
            id="add-origin"
            value={origin}
            onChange={(e) => { setOrigin(e.target.value); setOriginError(null); }}
            placeholder="https://textbook.com"
            data-testid="add-domain-origin"
          />
          {/* 원본 URL 필드 인라인 에러 */}
          {originError && (
            <p className="text-xs text-destructive" data-testid="add-domain-origin-error">
              {originError}
            </p>
          )}
        </div>
        {/* 서버 제출 오류 등 전역 에러 */}
        {submitError && (
          <p className="text-xs text-destructive" data-testid="add-domain-error">
            {submitError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={addDomain.isPending} data-testid="add-domain-submit">
            {addDomain.isPending ? '추가 중…' : '추가'}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

// ─── 단건 삭제 확인 다이얼로그 ──────────────────────────────────

function DeleteConfirmDialog({
  host,
  onConfirm,
  onCancel,
  isPending,
}: {
  host: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <AlertDialogContent className="max-w-sm" data-testid="delete-domain-dialog">
      <AlertDialogTitle>도메인 삭제</AlertDialogTitle>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono font-medium">{host}</span>을(를) 삭제하시겠습니까?
        DNS 오버라이드와 캐시가 함께 해제됩니다.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={isPending}
          data-testid="delete-domain-confirm"
        >
          {isPending ? '삭제 중…' : '삭제'}
        </Button>
      </div>
    </AlertDialogContent>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────

export function DomainsPage() {
  // 필터 상태를 URL searchParams와 동기화 — 새로고침/공유 시 검색 조건 유지 (#68)
  const [searchParams, setSearchParams] = useSearchParams();

  /** URL searchParams에서 현재 필터 값을 파생 */
  const filter: DomainsFilter = {
    q: searchParams.get('q') ?? undefined,
    // enabled 파라미터: 'true' | 'false' → boolean, 없으면 undefined
    enabled: searchParams.has('enabled')
      ? searchParams.get('enabled') === 'true'
      : undefined,
  };

  /** 필터 변경 시 URL searchParams에 반영 (replace: true로 히스토리 오염 방지) */
  function setFilter(next: DomainsFilter) {
    const params: Record<string, string> = {};
    if (next.q) params.q = next.q;
    if (next.enabled !== undefined) params.enabled = String(next.enabled);
    setSearchParams(params, { replace: true });
  }

  // 선택된 호스트 (일괄 작업용)
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());

  // 다이얼로그 표시 상태
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkAddDialog, setShowBulkAddDialog] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 데이터 훅
  const { data: domains, isLoading, isError } = useDomains(filter);
  const toggleMutation = useToggleDomain();
  const purgeMutation = usePurgeDomain();
  const deleteMutation = useDeleteDomain();

  // 단건 삭제 확인
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget);
      toast.success(`${deleteTarget} 도메인이 삭제되었습니다.`);
      // 삭제된 호스트 선택 해제
      setSelectedHosts((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget);
        return next;
      });
    } catch {
      toast.error('도메인 삭제에 실패했습니다.');
    }
    setDeleteTarget(null);
  }

  // 일괄 삭제 성공 후 선택 초기화
  function handleBulkDeleteSuccess() {
    setSelectedHosts(new Set());
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 페이지 헤더 */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">도메인 관리</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          등록된 도메인에 대해 DNS CDN IP 반환 + HTTPS 프록시 + 캐시가 활성화됩니다.
        </p>
      </div>

      {/* 요약 카드 4개 */}
      <DomainSummaryCards />

      {/* 경고 배너 (알림 있을 때만 표시) */}
      <DomainAlertBanner />

      {/* 툴바 — 추가/일괄 버튼 + 검색/필터 */}
      <DomainToolbar
        filter={filter}
        onFilterChange={setFilter}
        selectedCount={selectedHosts.size}
        onAddClick={() => setShowAddDialog(true)}
        onBulkAddClick={() => setShowBulkAddDialog(true)}
        onBulkDeleteClick={() => setShowBulkDeleteDialog(true)}
      />

      {/* 도메인 테이블 */}
      <Card className="flex-1 overflow-auto">
        <CardHeader><CardTitle>도메인 목록</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <p className="py-16 text-center text-sm text-destructive" data-testid="domains-error">
              도메인 목록을 불러오지 못했습니다.
            </p>
          ) : (
            <DomainTable
              domains={domains}
              isLoading={isLoading}
              selectedHosts={selectedHosts}
              onSelectChange={setSelectedHosts}
              onToggle={(host) => toggleMutation.mutate(host)}
              onPurge={(host) => purgeMutation.mutate(host)}
              onDelete={(host) => setDeleteTarget(host)}
              onAddDomain={() => setShowAddDialog(true)}
              searchQuery={filter.q}
            />
          )}
        </CardContent>
      </Card>

      {/* 도메인 추가 다이얼로그 */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <AddDomainDialog onClose={() => setShowAddDialog(false)} />
      </Dialog>

      {/* 단건 삭제 확인 다이얼로그 */}
      <AlertDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        {deleteTarget && (
          <DeleteConfirmDialog
            host={deleteTarget}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteTarget(null)}
            isPending={deleteMutation.isPending}
          />
        )}
      </AlertDialog>

      {/* 일괄 추가 다이얼로그 */}
      <DomainBulkAddDialog
        open={showBulkAddDialog}
        onOpenChange={setShowBulkAddDialog}
      />

      {/* 일괄 삭제 확인 다이얼로그 */}
      <DomainBulkDeleteDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        hosts={[...selectedHosts]}
        onSuccess={handleBulkDeleteSuccess}
      />
    </div>
  );
}
