/**
 * 도메인 관리 페이지 — 전면 교체
 * - 요약 카드, 경고 배너, 툴바, 테이블, 다이얼로그 서브 컴포넌트 조합
 * - 기존 사이드패널 + 프록시 테스트 제거
 * - 필터 상태를 useSearchParams로 관리하여 URL에 동기화 (#68)
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { getApiError } from '../lib/api';
import { useDomains } from '../hooks/useDomains';
import { useAddDomain } from '../hooks/useAddDomain';
import { useDeleteDomain } from '../hooks/useDeleteDomain';
import { useToggleDomain, usePendingToggleHosts } from '../hooks/useToggleDomain';
import { usePurgeDomain, usePendingPurgeHosts } from '../hooks/usePurgeDomain';
import { useCertificates } from '../hooks/useTls';
import { useCacheStats } from '../hooks/useCacheStats';
import type { DomainsFilter } from '../api/domain-types';
import { DomainSummaryCards } from '../components/domains/DomainSummaryCards';
import { DomainAlertBanner } from '../components/domains/DomainAlertBanner';
import { DomainToolbar } from '../components/domains/DomainToolbar';
import { DomainTable } from '../components/domains/DomainTable';
import { DomainBulkAddDialog } from '../components/domains/DomainBulkAddDialog';
import { DomainBulkDeleteDialog } from '../components/domains/DomainBulkDeleteDialog';
import { eulReul } from '../lib/korean';

// ─── 도메인 추가 다이얼로그 ──────────────────────────────────────

/**
 * RFC-1123 도메인명 검증 정규식 (UX 사전 검증용)
 * - 와일드카드(*.sub.domain.com) 허용
 * - 각 레이블은 영문자·숫자·하이픈으로 구성, 하이픈으로 시작/끝 불가
 * - XSS 페이로드(<script> 등) 및 특수문자 차단
 * - 서버(`routes/domains.ts`)와 동일한 정규식 — 클라이언트는 UX용 사전 차단만 담당
 */
const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * origin URL 최대 길이 — 서버 `routes/domains.ts` ORIGIN_MAX_LENGTH(2083)와 동일 (#423).
 * RFC 7230 권장 한도이며 서버가 거부하기 전에 클라에서 사전 차단해 사용자에게 즉시 피드백한다.
 */
const ORIGIN_MAX_LENGTH = 2083;

/**
 * origin URL 클라이언트 검증 — 서버 `isValidOrigin`(routes/domains.ts:383)과 동일 규칙 (#423).
 *
 * 과거에는 `startsWith('http://'|'https://')` 만 검사해 path/query/fragment/공백/빈 host/
 * 과도 길이가 모두 통과 → 서버 400 → catch 가 generic 메시지로 덮어써 사용자가 사유를 모르는
 * UX 회귀가 발생했다. 서버 정책과 1:1 동기화하여 사전에 인라인 에러로 안내한다.
 *
 * 검증 항목 (서버와 일치):
 * - 길이 1~ORIGIN_MAX_LENGTH(2083)
 * - 공백/탭/개행 미포함 (`http://exa mple.com` 같은 host 중간 공백 차단)
 * - `new URL()` 파싱 가능
 * - protocol 이 `http:` 또는 `https:`
 * - hostname 비어 있지 않음 (`http://`, `https:///` 같은 빈 host 거부)
 * - path/query/fragment 없음 (origin URL 은 scheme+host[+port] 만 의미)
 */
function isValidOrigin(origin: string): boolean {
  if (origin.length === 0 || origin.length > ORIGIN_MAX_LENGTH) return false;
  if (/\s/.test(origin)) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!url.hostname) return false;
  // `new URL()` 은 path 가 없어도 pathname 을 '/' 로 자동 채우므로 '/' 만 허용
  if (url.pathname !== '' && url.pathname !== '/') return false;
  if (url.search !== '') return false;
  if (url.hash !== '') return false;
  return true;
}

/**
 * 도메인 추가 다이얼로그 (#421)
 *
 * 구조: Dialog/DialogContent 를 컴포넌트 내부에서 직접 렌더링한다.
 * 이유: mutation 핸들(`addDomain`)이 컴포넌트 내부에 있어야 ESC/백드롭/X/취소 4개 닫기 경로 모두에
 *      `isPending` 가드를 일관되게 걸 수 있다. 과거에는 외부 `<Dialog open onClose>` 래퍼가
 *      DomainsPage 본체에 있어 mutation 상태에 접근하지 못해 silent close 가 발생했다 (#421).
 *      DomainBulkAddDialog 와 동일한 패턴으로 정리.
 *
 * 가드 지점:
 * - DialogContent disableClose={addDomain.isPending} → X 버튼 disabled
 * - Dialog onClose 핸들러에서 isPending 이면 닫기 무시 → ESC/백드롭 차단
 * - 취소 버튼 disabled={addDomain.isPending} → 클릭 차단
 */
function AddDomainDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [host, setHost] = useState('');
  const [origin, setOrigin] = useState('');
  // 필드별 개별 에러 상태 — 각 입력 필드 바로 아래에 인라인으로 표시하기 위해 분리
  const [hostError, setHostError] = useState<string | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  // 서버 오류 등 전역 에러(어느 필드에 귀속시키기 어려운 경우)
  const [submitError, setSubmitError] = useState<string | null>(null);
  const addDomain = useAddDomain();

  /**
   * 닫기 공통 핸들러 — mutation 진행 중에는 모든 닫기 경로(ESC/백드롭/X/취소)를 무시한다 (#421).
   * 외부 Wrapper 가 useState 를 보존하므로 닫힘 직전 입력값/에러 상태를 직접 리셋해
   * 재오픈 시 잔존을 방지한다 (DomainBulkAddDialog #170 패턴과 동일).
   */
  const handleClose = () => {
    if (addDomain.isPending) return;
    setHost('');
    setOrigin('');
    setHostError(null);
    setOriginError(null);
    setSubmitError(null);
    onOpenChange(false);
  };

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    // 제출 시 기존 에러 초기화
    setHostError(null);
    setOriginError(null);
    setSubmitError(null);

    // host 정규화 — DNS 호스트네임은 RFC 1035 §2.3.3 case-insensitive 이고 서버도 lowercase 로
    // 통일 저장하므로(#201), 클라이언트도 동일 규칙을 적용해 검증·전송 일관성을 맞춘다.
    const h = host.trim().toLowerCase();
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
    } else if (!isValidOrigin(o)) {
      // 서버 `isValidOrigin` 과 동일한 종합 검증 — protocol/host/path/query/fragment/공백/길이 (#423).
      // 사용자에게 가장 흔한 실수(scheme 누락, path 포함)를 우선 안내한다.
      if (!o.startsWith('http://') && !o.startsWith('https://')) {
        setOriginError('오리진 URL은 http:// 또는 https://로 시작해야 합니다.');
      } else {
        setOriginError(`유효한 오리진 URL이 아닙니다. 경로/쿼리/공백 없이 scheme://host[:port] 형식이어야 합니다. (예: https://example.com, 최대 ${ORIGIN_MAX_LENGTH}자)`);
      }
      hasError = true;
    }
    if (hasError) return;

    try {
      await addDomain.mutateAsync({ host: h, origin: o });
      toast.success(`${h} 도메인이 추가되었습니다.`);
      // 성공 시 입력값/에러 잔존 방지 (#421) — handleClose 와 동일 리셋 흐름
      setHost('');
      setOrigin('');
      onOpenChange(false);
    } catch (e) {
      // 서버 표준 envelope (#410) 의 message 를 사용자에게 그대로 전달 — generic 메시지로 사유가 손실되던
      // UX 회귀(#423) 방지. origin 관련 코드는 origin 필드 인라인 에러로, 그 외는 전역 submitError 로 표시.
      const { code, message } = getApiError(e);
      if (code === 'origin_invalid' && message) {
        setOriginError(message);
      } else if (code === 'domain_invalid_format' && message) {
        setHostError(message);
      } else {
        setSubmitError(message ?? '도메인 추가에 실패했습니다.');
      }
    }
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent data-testid="add-domain-dialog" disableClose={addDomain.isPending}>
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
              // 입력 즉시 lowercase 로 표시 — DNS host 가 case-insensitive 이므로 사용자가 친 대문자도
              // 소문자로 보이도록 즉각 정규화 (#201). 서버는 어차피 lowercase 로 저장한다.
              onChange={(e) => { setHost(e.target.value.toLowerCase()); setHostError(null); }}
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
          {/* Tab 순서 정정 (#237) — DOM 상 주 액션(추가)을 먼저 두어 입력 → 추가 → 취소 → X 순으로
              포커스가 흐르게 한다. 시각적으로는 좌:취소, 우:추가 위치를 유지해야 하므로
              flex-row-reverse 로 배치 순서만 뒤집는다. */}
          <div className="flex flex-row-reverse justify-start gap-2 pt-2">
            {/* 빈 입력 가드 — toolbar/일괄 삭제·DomainCacheSection 퍼지와 disabled 처리 일관성 유지 (#232).
                인라인 에러는 의도적 입력 후 형식 오류 알림용이며 빈 폼 제출 가드용으로 쓰지 않는다. */}
            <Button
              type="submit"
              disabled={addDomain.isPending || !host.trim() || !origin.trim()}
              data-testid="add-domain-submit"
            >
              {addDomain.isPending ? '추가 중…' : '추가'}
            </Button>
            {/* 취소 — mutation 진행 중 disabled 로 닫기 차단 (#421) */}
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={addDomain.isPending}
            >
              취소
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
        <span className="font-mono font-medium">{host}</span>{eulReul(host)} 삭제하시겠습니까?
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
  // enabled 파라미터 strict 검증 — 'true'/'false'만 허용하고, 그 외 값('invalid', '', '1', 'True' 등)은
  // silent하게 false로 해석되던 버그(#242)를 막기 위해 undefined로 fallback한다.
  const enabledRaw = searchParams.get('enabled');
  const enabledFilter =
    enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : undefined;
  // 잘못된 enabled 값은 URL에서 제거 — 사용자가 잘못된 상태로 공유 링크를 만드는 것을 방지
  const hasInvalidEnabled = enabledRaw !== null && enabledFilter === undefined;
  const filter: DomainsFilter = {
    q: searchParams.get('q') ?? undefined,
    enabled: enabledFilter,
    // sort/order: 없으면 undefined (API 기본값 created_at DESC로 동작)
    sort: searchParams.get('sort') ?? undefined,
    order: (searchParams.get('order') as 'asc' | 'desc' | null) ?? undefined,
  };

  // 잘못된 enabled 쿼리값을 URL에서 제거 (마운트/변경 시 1회). replace로 히스토리 오염 방지.
  useEffect(() => {
    if (!hasInvalidEnabled) return;
    const next = new URLSearchParams(searchParams);
    next.delete('enabled');
    setSearchParams(next, { replace: true });
  }, [hasInvalidEnabled, searchParams, setSearchParams]);

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
   *
   * 이슈 #350 — 클라이언트 측 정렬 키('requests'/'cache_hits'/'tls_expires')는 서버
   * SORT_ALLOWED 화이트리스트에 없어 400 으로 거부된다. URL csort/corder 쿼리로 별도 보존하고
   * filter.sort 에는 넣지 않는다. DomainTable 이 csort 기준으로 in-memory 정렬.
   * 'host' 는 서버 정렬 유지 (filter.sort).
   */
  const CLIENT_SORT_KEYS = new Set(['requests', 'cache_hits', 'tls_expires']);
  function handleSortChange(key: string, dir: 'asc' | 'desc') {
    setSelectedHosts(new Set());
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (CLIENT_SORT_KEYS.has(key)) {
        // 서버 sort/order 제거 → admin-server 화이트리스트 400 방지
        params.delete('sort'); params.delete('order');
        params.set('csort', key); params.set('corder', dir);
      } else {
        params.delete('csort'); params.delete('corder');
        params.set('sort', key); params.set('order', dir);
      }
      return params;
    }, { replace: true });
  }

  // 이슈 #350 — DomainTable 에 전달할 effective sort: 클라이언트 키 우선, 없으면 서버 키.
  const csortKey = searchParams.get('csort');
  const csortDir = searchParams.get('corder') as 'asc' | 'desc' | null;
  const effectiveSortKey = csortKey ?? filter.sort;
  const effectiveSortDir = (csortDir ?? filter.order) as 'asc' | 'desc' | undefined;

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
  // in-flight 호스트 집합 — 서로 다른 행을 빠르게 연속 클릭해도 모든 진행 중인 행을
  // disabled로 유지하기 위해 Set으로 추적한다 (#205, useMutationState 기반).
  const pendingToggleHosts = usePendingToggleHosts();
  const pendingPurgeHosts = usePendingPurgeHosts();

  // TLS 인증서 목록 — GET /api/tls/certificates 를 한 번 조회해
  // 도메인별 만료일 맵을 만든다 (N+1 아님, 전체 목록 한 번 요청)
  const { data: certs } = useCertificates();
  const tlsExpiryByHost = useMemo(
    () => new Map(certs?.map((c) => [c.domain, c.expires_at])),
    [certs],
  );

  // 도메인별 캐시 통계 — Dashboard ByDomainTable과 동일 hook(useCacheStats) 재사용 (#346).
  // by_domain[]을 host 키 Map으로 변환해 DomainTable이 O(1) 조회로 셀에 표시한다.
  const { data: cacheStats } = useCacheStats();
  const statsByHost = useMemo(
    () => new Map(cacheStats?.by_domain.map((d) => [d.host, d])),
    [cacheStats],
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
        <h2 className="text-2xl font-semibold tracking-tight">도메인</h2>
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
              pendingToggleHosts={pendingToggleHosts}
              onPurge={(host) => purgeMutation.mutate(host)}
              pendingPurgeHosts={pendingPurgeHosts}
              onDelete={(host) => setDeleteTarget(host)}
              onAddDomain={() => setShowAddDialog(true)}
              searchQuery={filter.q}
              enabledFilter={filter.enabled}
              // 검색 초기화: q 파라미터만 제거하고 나머지 필터(enabled, sort, order)는 유지 (#126)
              onClearSearch={() => setFilter({ ...filter, q: undefined })}
              // 필터 해제: enabled 파라미터만 제거하고 나머지 필터(q, sort, order)는 유지 (#126)
              onClearFilter={() => setFilter({ ...filter, enabled: undefined })}
              sortKey={effectiveSortKey}
              sortDir={effectiveSortDir}
              onSortChange={handleSortChange}
              tlsExpiryByHost={tlsExpiryByHost}
              statsByHost={statsByHost}
            />
          )}
        </CardContent>
      </Card>

      {/* 도메인 추가 다이얼로그 — Dialog/onClose 가드는 컴포넌트 내부에서 처리 (#421) */}
      <AddDomainDialog open={showAddDialog} onOpenChange={setShowAddDialog} />

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
