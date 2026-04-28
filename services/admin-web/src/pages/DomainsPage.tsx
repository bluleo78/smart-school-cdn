/**
 * 도메인 관리 페이지 — 전면 교체
 * - 요약 카드, 경고 배너, 툴바, 테이블, 다이얼로그 서브 컴포넌트 조합
 * - 기존 사이드패널 + 프록시 테스트 제거
 * - 필터 상태를 useSearchParams로 관리하여 URL에 동기화 (#68)
 */
import { useMemo, useState } from 'react';
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
import { useCertificates } from '../hooks/useTls';
import type { DomainsFilter } from '../api/domain-types';
import { DomainSummaryCards } from '../components/domains/DomainSummaryCards';
import { DomainAlertBanner } from '../components/domains/DomainAlertBanner';
import { DomainToolbar } from '../components/domains/DomainToolbar';
import { DomainTable } from '../components/domains/DomainTable';
import { DomainBulkAddDialog } from '../components/domains/DomainBulkAddDialog';
import { DomainBulkDeleteDialog } from '../components/domains/DomainBulkDeleteDialog';

// ─── 도메인 추가 다이얼로그 ──────────────────────────────────────

/**
 * RFC-1123 도메인명 검증 정규식 (UX 사전 검증용)
 * - 와일드카드(*.sub.domain.com) 허용
 * - 각 레이블은 영문자·숫자·하이픈으로 구성, 하이픈으로 시작/끝 불가
 * - XSS 페이로드(<script> 등) 및 특수문자 차단
 * - 서버(`routes/domains.ts`)와 동일한 정규식 — 클라이언트는 UX용 사전 차단만 담당
 */
const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

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
    } else if (!DOMAIN_RE.test(h)) {
      // RFC-1123 형식 검증 — XSS 페이로드·특수문자 사전 차단 (UX용, 서버도 동일 검증 수행)
      setHostError('유효한 도메인 형식이 아닙니다. (예: example.com, *.sub.com)');
      hasError = true;
    }
    if (!o) {
      setOriginError('오리진 URL을 입력해주세요.');
      hasError = true;
    } else if (!o.startsWith('http://') && !o.startsWith('https://')) {
      setOriginError('오리진 URL은 http:// 또는 https://로 시작해야 합니다.');
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
            오리진 URL <span className="text-destructive" aria-hidden="true">*</span>
          </label>
          <Input
            id="add-origin"
            value={origin}
            onChange={(e) => { setOrigin(e.target.value); setOriginError(null); }}
            placeholder="https://textbook.com"
            data-testid="add-domain-origin"
          />
          {/* 오리진 URL 필드 인라인 에러 — 테이블 헤더 '오리진'과 용어 통일 (이슈 #128) */}
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
    <AlertDialogContent className="max-w-sm" data-testid="delete-domain-dialog" disableClose={isPending}>
      <AlertDialogTitle>도메인 삭제</AlertDialogTitle>
      <p className="text-sm text-muted-foreground">
        <span className="font-mono font-medium">{host}</span>을(를) 삭제하시겠습니까?
        DNS 오버라이드와 캐시가 함께 해제됩니다.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
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
    // sort/order: 없으면 undefined (API 기본값 created_at DESC로 동작)
    sort: searchParams.get('sort') ?? undefined,
    order: (searchParams.get('order') as 'asc' | 'desc' | null) ?? undefined,
  };

  /**
   * 필터 변경 시 URL searchParams에 반영 (replace: true로 히스토리 오염 방지).
   * 필터가 바뀌면 현재 뷰에 없는 도메인이 선택 상태로 남지 않도록 선택을 초기화한다.
   */
  function setFilter(next: DomainsFilter) {
    // 필터 변경 시 선택 초기화 — 숨겨진 도메인의 일괄 삭제를 방지한다
    setSelectedHosts(new Set());
    const params: Record<string, string> = {};
    if (next.q) params.q = next.q;
    if (next.enabled !== undefined) params.enabled = String(next.enabled);
    // 기본값(sort=created_at, order=desc)은 URL에 포함하지 않아 URL을 깔끔하게 유지
    if (next.sort) params.sort = next.sort;
    if (next.order) params.order = next.order;
    setSearchParams(params, { replace: true });
  }

  /**
   * 정렬 헤더 클릭 핸들러 — DomainTable에서 컬럼/방향이 결정된 뒤 filter에 반영한다.
   * 기존 q/enabled 필터는 그대로 유지하며 sort/order만 교체한다.
   */
  function handleSortChange(key: string, dir: 'asc' | 'desc') {
    setFilter({ ...filter, sort: key, order: dir });
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

  // TLS 인증서 목록 — GET /api/tls/certificates 를 한 번 조회해
  // 도메인별 만료일 맵을 만든다 (N+1 아님, 전체 목록 한 번 요청)
  const { data: certs } = useCertificates();
  const tlsExpiryByHost = useMemo(
    () => new Map(certs?.map((c) => [c.domain, c.expires_at])),
    [certs],
  );

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
              pendingToggleHost={toggleMutation.isPending ? (toggleMutation.variables ?? null) : null}
              onPurge={(host) => purgeMutation.mutate(host)}
              pendingPurgeHost={purgeMutation.isPending ? (purgeMutation.variables ?? null) : null}
              onDelete={(host) => setDeleteTarget(host)}
              onAddDomain={() => setShowAddDialog(true)}
              searchQuery={filter.q}
              enabledFilter={filter.enabled}
              // 검색 초기화: q 파라미터만 제거하고 나머지 필터(enabled, sort, order)는 유지 (#126)
              onClearSearch={() => setFilter({ ...filter, q: undefined })}
              // 필터 해제: enabled 파라미터만 제거하고 나머지 필터(q, sort, order)는 유지 (#126)
              onClearFilter={() => setFilter({ ...filter, enabled: undefined })}
              sortKey={filter.sort}
              sortDir={filter.order}
              onSortChange={handleSortChange}
              tlsExpiryByHost={tlsExpiryByHost}
            />
          )}
        </CardContent>
      </Card>

      {/* 도메인 추가 다이얼로그 */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <AddDomainDialog onClose={() => setShowAddDialog(false)} />
      </Dialog>

      {/* 단건 삭제 확인 다이얼로그 — 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={!!deleteTarget} onClose={() => { if (!deleteMutation.isPending) setDeleteTarget(null); }}>
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
