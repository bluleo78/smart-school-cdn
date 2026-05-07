/// 도메인 설정 탭 — Origin 편집, 캐시 퍼지, 최적화 프로파일, TLS 정보, 위험 영역(삭제)
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Domain } from '../../../api/domain-types';
import { useUpdateDomain } from '../../../hooks/useUpdateDomain';
import { useDeleteDomain } from '../../../hooks/useDeleteDomain';
import { useDomainTls } from '../../../hooks/useDomainTls';
import { useTlsRenew } from '../../../hooks/useTlsRenew';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../ui/alert-dialog';
import { useUnsavedChangesPrompt } from '../../../hooks/useUnsavedChangesPrompt';
import { DomainCacheSection } from './DomainCacheSection';
import { DomainOptimizerSection } from './DomainOptimizerSection';
import { TlsStatusBadge } from '../../TlsStatusBadge';
import { toast } from 'sonner';

interface Props {
  domain: Domain;
}

export function DomainSettingsTab({ domain }: Props) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="domain-settings-tab">
      {/* 1. Origin 설정 */}
      <OriginSection domain={domain} />

      {/* 2. 캐시 퍼지 */}
      <DomainCacheSection host={domain.host} />

      {/* 3. 최적화 프로파일 */}
      <DomainOptimizerSection host={domain.host} />

      {/* 4. TLS / 인증서 */}
      <TlsSection host={domain.host} />

      {/* 3. 위험 영역 */}
      <DangerSection host={domain.host} navigate={navigate} />
    </div>
  );
}

/** Origin 설정 카드 — 읽기/편집 토글 */
function OriginSection({ domain }: { domain: Domain }) {
  /** 편집 모드 토글 state */
  const [editing, setEditing] = useState(false);
  /** 편집 중 origin 값 */
  const [origin, setOrigin] = useState(domain.origin);
  /** 편집 중 description 값 */
  const [description, setDescription] = useState(domain.description);

  const updateMutation = useUpdateDomain();

  /**
   * 미저장 dirty 여부 — 편집 모드 + (origin 또는 description이 원본과 다름).
   * CDN의 origin 설정은 한 번 잘못 저장되면 캐시 미스/오리진 폭주를 유발할 수 있는
   * 민감 항목이라 페이지 이탈 전 명시적 확인이 필요하다 (#171).
   */
  const isDirty =
    editing && (origin !== domain.origin || description !== domain.description);

  // 페이지 이탈 가드 — SPA 내 이동(사이드바/뒤로가기/도메인 행 클릭)은 AlertDialog,
  // 외부 이탈(탭 닫기/새로고침)은 브라우저 표준 beforeunload로 가드.
  const { pendingNavigation, confirmNavigation, cancelNavigation } =
    useUnsavedChangesPrompt({ isDirty });

  /** 편집 취소 — 원래 값으로 복원 */
  function handleCancel() {
    setOrigin(domain.origin);
    setDescription(domain.description);
    setEditing(false);
  }

  /** 저장 — origin 빈값·스킴 클라이언트 검증 후 뮤테이션 호출, 편집 모드 해제 */
  function handleSave() {
    // 입력값 정규화 — leading/trailing 공백을 제거한 뒤 모든 검증·전송에 사용한다.
    // raw origin으로 검증하면 leading 공백이 있을 때 scheme 검사가 false가 되어
    // "https://로 시작해야 합니다" 같은 오해 소지 메시지가 노출되고, trailing 공백은
    // 클라 검증을 통과해 서버 거부로 일반 실패 토스트만 보이는 문제가 있었다 (#229).
    // AddDomainDialog(pages/DomainsPage.tsx)와 동일한 trim-then-validate 패턴 적용.
    const o = origin.trim();
    const d = description.trim();

    // 오리진 빈값 검증 — 서버로 보내기 전에 차단하여 데이터 무결성 보장
    if (!o) {
      toast.error('오리진 URL을 입력해 주세요.');
      return;
    }
    // 오리진 스킴 검증 — http:// 또는 https://로 시작해야 Proxy가 올바르게 업스트림에 연결 가능
    // AddDomainDialog와 동일한 이중 방어 적용 (#103)
    if (!o.startsWith('http://') && !o.startsWith('https://')) {
      toast.error('오리진 URL은 http:// 또는 https://로 시작해야 합니다.');
      return;
    }
    updateMutation.mutate(
      { host: domain.host, body: { origin: o, description: d } },
      {
        onSuccess: (data) => {
          // 서버 응답값으로 로컬 state를 명시적으로 동기화
          // — useState 초기값은 마운트 시 1회만 평가되므로, React Query 무효화 후
          //   prop이 갱신되어도 state가 자동 반영되지 않음.
          //   저장 후 재편집 시 서버 정규화 값이 아닌 입력값이 표시되는 버그 방지 (#137)
          setOrigin(data.origin);
          setDescription(data.description);
          setEditing(false);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">오리진 설정</CardTitle>
        {!editing && (
          <Button
            variant="outline"
            onClick={() => setEditing(true)}
            data-testid="edit-domain-btn"
            size="xs"
          >
            편집
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 호스트 — 항상 읽기 전용 */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">호스트</Label>
          <p className="text-sm font-medium">{domain.host}</p>
        </div>

        {editing ? (
          /* 편집 폼 — form 태그로 감싸 Enter 키 제출 활성화, onKeyDown으로 Esc 취소 처리.
             IME 조합 중(한글/일본어/중국어 등)에는 Escape를 무시하여 사용자가 IME 조합 취소만
             의도했는데 편집 폼 전체가 닫혀 입력값이 손실되는 문제를 방지한다 (#179).
             표준 가드: e.nativeEvent.isComposing(모던 브라우저) || e.keyCode === 229(레거시). */
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            onKeyDown={(e) => {
              // IME 조합 중 Escape는 IME에 위임 — 편집 취소로 처리하지 않음
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Escape') handleCancel();
            }}
          >
            {/* Origin 입력 */}
            <div className="space-y-1">
              <Label htmlFor="origin-input" className="text-xs text-muted-foreground">
                오리진
              </Label>
              {/* maxLength={2083} — 서버 ORIGIN_MAX_LENGTH(routes/domains.ts)와 동기화한 클라이언트 방어선.
                  description(#155)·users 이메일(#253)과 같은 패턴으로 입력 단계에서 길이 초과를 차단해
                  서버 거절·로그 폭주를 사전에 방지한다 (#254). */}
              <Input
                id="origin-input"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                data-testid="origin-input"
                className="h-8 text-sm"
                maxLength={2083}
              />
            </div>

            {/* 설명 입력 */}
            <div className="space-y-1">
              <Label htmlFor="description-input" className="text-xs text-muted-foreground">
                설명
              </Label>
              {/* maxLength={500} — 서버 제한(500자)과 일치하는 클라이언트 방어선 (#155) */}
              <Input
                id="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-sm"
                maxLength={500}
              />
            </div>

            {/* 저장 / 취소 버튼 */}
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="save-domain-btn"
                size="xs"
              >
                {updateMutation.isPending ? '저장 중...' : '저장'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={updateMutation.isPending}
                size="xs"
              >
                취소
              </Button>
            </div>
          </form>
        ) : (
          <>
            {/* 읽기 모드 */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">오리진</Label>
              <p className="text-sm">{domain.origin}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">설명</Label>
              <p className="text-sm">{domain.description || '—'}</p>
            </div>
          </>
        )}
      </CardContent>

      {/* 미저장 변경 확인 다이얼로그 — useUnsavedChangesPrompt가 SPA 이동을 차단하면 표시.
          "취소"는 현재 페이지 유지, "떠나기"는 차단된 이동을 재개. */}
      <AlertDialog open={pendingNavigation !== null} onClose={cancelNavigation}>
        <AlertDialogContent className="max-w-sm" data-testid="unsaved-changes-dialog">
          <AlertDialogTitle>저장하지 않은 변경 사항이 있습니다</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            오리진 설정에 저장하지 않은 변경 사항이 있습니다. 페이지를 떠나면
            입력한 내용이 사라집니다. 정말 떠나시겠습니까?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={cancelNavigation}
              size="sm"
              data-testid="unsaved-cancel-btn"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={confirmNavigation}
              size="sm"
              data-testid="unsaved-leave-btn"
            >
              떠나기
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** TLS / 인증서 카드 — useDomainTls hook으로 실제 인증서 데이터 표시
 * 상태 표시는 TlsStatusBadge로 통일 (#73)
 * 수동 갱신 버튼은 useTlsRenew 훅으로 활성화 — DomainQuickActions와 동일 기능 (#102)
 */
function TlsSection({ host }: { host: string }) {
  // isError를 함께 destructure — 인증서 조회 실패 시 '미발급' 거짓 표시 대신
  // 명시적 에러 메시지를 노출하고, 미확정 상태에서 '수동 갱신' 트리거를 막는다 (#247)
  const { data: cert, isError } = useDomainTls(host);
  /** TLS 수동 갱신 뮤테이션 — 갱신 중 버튼 비활성화로 중복 요청 방지 */
  const tlsRenewMutation = useTlsRenew();

  /** ISO 8601 문자열 → 한국어 날짜 문자열 (없으면 '—') */
  const toKoDate = (iso: string | undefined) =>
    iso ? new Date(iso).toLocaleDateString('ko-KR') : '—';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">TLS / 인증서</CardTitle>
        {/* 수동 갱신 — useTlsRenew 훅으로 활성화, 갱신 진행 중에만 disabled (#102)
            인증서 조회 실패(isError) 시에도 비활성화 — 미확정 상태에서 잘못된 갱신 트리거 방지 (#247) */}
        <Button
          variant="outline"
          size="xs"
          disabled={tlsRenewMutation.isPending || isError}
          onClick={() => tlsRenewMutation.mutate(host)}
          data-testid="tls-renew-settings"
        >
          {tlsRenewMutation.isPending ? '갱신 중…' : '수동 갱신'}
        </Button>
      </CardHeader>
      <CardContent>
        {/* API 호출 실패 시 — '미발급' 거짓 표시 대신 명시적 에러 메시지 노출 (#247, #154 패턴) */}
        {isError ? (
          <p className="text-sm text-destructive" data-testid="tls-section-error">
            인증서 정보를 불러올 수 없습니다
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <TlsRow label="상태">
              <TlsStatusBadge expiresAt={cert?.expires_at} />
            </TlsRow>
            <TlsRow label="발급자">자동 발급</TlsRow>
            <TlsRow label="만료일">{toKoDate(cert?.expires_at)}</TlsRow>
            <TlsRow label="마지막 갱신">{toKoDate(cert?.issued_at)}</TlsRow>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** TLS 정보 행 */
function TlsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

/** 위험 영역 — 도메인 삭제 */
function DangerSection({
  host,
  navigate,
}: {
  host: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  /** 삭제 확인 다이얼로그 열림 state */
  const [open, setOpen] = useState(false);
  const deleteMutation = useDeleteDomain();

  /** 삭제 확인 → 뮤테이션 → 목록 페이지로 이동 */
  function handleDelete() {
    deleteMutation.mutate(host, {
      onSuccess: () => {
        setOpen(false);
        void navigate('/domains');
      },
      onError: () => {
        toast.error('도메인 삭제에 실패했습니다.');
      },
    });
  }

  return (
    <Card className="border border-destructive/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-destructive">위험 영역</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          이 도메인과 관련된 모든 캐시 데이터가 삭제됩니다.
        </p>
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          size="sm"
          data-testid="danger-delete-open"
        >
          도메인 삭제
        </Button>
      </CardContent>

      {/* 삭제 확인 다이얼로그 — pending 중에는 ESC/백드롭/X 닫기 차단 (#183, #165 패턴) */}
      <Dialog
        open={open}
        onClose={() => {
          if (!deleteMutation.isPending) setOpen(false);
        }}
      >
        <DialogContent disableClose={deleteMutation.isPending} data-testid="danger-delete-dialog">
          <DialogTitle>도메인 삭제</DialogTitle>
          <p className="text-sm text-muted-foreground">
            <strong>{host}</strong> 도메인을 삭제하시겠습니까?
            <br />
            이 도메인과 관련된 모든 캐시 데이터가 영구적으로 삭제됩니다.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deleteMutation.isPending}
              size="sm"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              size="sm"
              data-testid="danger-delete-confirm"
            >
              {deleteMutation.isPending ? '삭제 중...' : '삭제'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
