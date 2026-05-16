/// 도메인 설정 탭 — 최적화 프로파일 편집 섹션
import { useState } from 'react';
import { toast } from 'sonner';
import { useOptimizerProfile } from '../../../hooks/useOptimizerProfile';
import { useUpdateOptimizerProfile } from '../../../hooks/useUpdateOptimizerProfile';
import { useUnsavedChangesPrompt } from '../../../hooks/useUnsavedChangesPrompt';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../ui/alert-dialog';

interface Props {
  host: string;
}

export function DomainOptimizerSection({ host }: Props) {
  // isError를 함께 destructure하여 API 실패 시 에러 상태를 명시적으로 처리한다 (#246).
  // 누락 시 data=undefined가 "프로파일 미설정"(null)과 구분되지 않아 [기본값으로 활성화] 버튼이 노출되고,
  // 사용자가 누르면 실제 존재하던 프로파일을 quality=85/max_width=0으로 덮어쓰는 정합성 문제 발생.
  const { data: profile, isLoading, isError } = useOptimizerProfile(host);
  const updateMutation = useUpdateOptimizerProfile();

  // 편집 중인 로컬 상태.
  // - undefined: 미편집 (서버 값 사용)
  // - null: 사용자가 입력을 모두 지움 (빈 input 유지 — 0으로 보정 금지)
  // - number: 사용자가 입력한 숫자
  // 빈값 보정으로 0이 들어가면 dirty 오탐·잘못된 검증 토스트·의도치 않은 max_width=0 저장이 발생해(#215),
  // null sentinel로 "값 미입력"을 명시 보존한다.
  const [localQuality, setQuality] = useState<number | null | undefined>(undefined);
  const [localMaxWidth, setMaxWidth] = useState<number | null | undefined>(undefined);
  const [localEnabled, setEnabled] = useState<boolean | null>(null);

  // 표시용 값 — null(빈값)이면 ''를 그대로 input에 바인딩해 빈 필드를 유지한다.
  const qualityDisplay: number | '' =
    localQuality === undefined ? (profile?.quality ?? 85) : (localQuality ?? '');
  const maxWidthDisplay: number | '' =
    localMaxWidth === undefined ? (profile?.max_width ?? 0) : (localMaxWidth ?? '');
  const enabled = localEnabled ?? profile?.enabled ?? true;

  /**
   * 미저장 dirty 여부 — 로컬 편집 state가 서버값과 다른지 비교.
   * 최적화 프로파일은 잘못 저장되면 이미지 품질 저하·과도한 최대 너비로 트래픽 폭주를
   * 유발할 수 있는 민감 항목이라 페이지 이탈 전 명시적 확인이 필요하다 (#172).
   * — OriginSection(#171)과 동일 패턴.
   */
  const isDirty =
    !!profile &&
    ((localQuality !== undefined && localQuality !== profile.quality) ||
      (localMaxWidth !== undefined && localMaxWidth !== profile.max_width) ||
      (localEnabled !== null && localEnabled !== profile.enabled));

  // 페이지 이탈 가드 — SPA 내 이동(사이드바/뒤로가기/도메인 행 클릭)은 AlertDialog,
  // 외부 이탈(탭 닫기/새로고침)은 브라우저 표준 beforeunload로 가드.
  const { pendingNavigation, confirmNavigation, cancelNavigation } =
    useUnsavedChangesPrompt({ isDirty });

  /** 저장 — 서버 전송 전 클라이언트 범위 검증으로 불필요한 API 호출을 방지한다 */
  function handleSave() {
    // dirty 가드 — 변경 없으면 PUT 발송·거짓 성공 토스트를 차단한다 (#313).
    // 버튼 disabled 외에 Enter 키 폼 제출 등 다른 진입 경로도 방어.
    if (!isDirty) return;
    // 빈값(null)은 "값 미입력"으로 간주해 NaN 가드와 함께 명시 거부한다 (#215).
    const q = qualityDisplay;
    const mw = maxWidthDisplay;
    // 서버 JSON-Schema(`services/admin-server/src/routes/optimizer.ts`)와 동일 제약을 클라가 사전 차단한다.
    // - quality: integer 1–100
    // - max_width: integer 0–65535
    // 정수/상한 가드가 빠지면 서버 raw 영문(`body/quality must be integer`, `body/max_width must be <= 65535`)이
    // toast로 그대로 노출되어 한국어 일관성을 깨뜨린다 (#314, #48 server message passthrough와 양립).
    if (q === '' || !Number.isFinite(q) || q < 1 || q > 100) {
      toast.error('품질은 1–100 사이여야 합니다.');
      return;
    }
    if (!Number.isInteger(q)) {
      toast.error('품질은 정수여야 합니다.');
      return;
    }
    if (mw === '' || !Number.isFinite(mw) || mw < 0) {
      toast.error('최대 너비는 0 이상이어야 합니다.');
      return;
    }
    if (!Number.isInteger(mw)) {
      toast.error('최대 너비는 정수여야 합니다.');
      return;
    }
    if (mw > 65535) {
      toast.error('최대 너비는 65535 이하여야 합니다.');
      return;
    }
    updateMutation.mutate(
      { domain: host, quality: q, max_width: mw, enabled },
      {
        onSuccess: () => {
          // 저장 후 로컬 state를 undefined로 리셋해 서버 재동기화를 보장한다.
          // — 외부에서 profile이 갱신되어도 stale한 로컬 state가 우선되는 결함 방지 (#137·#172).
          setQuality(undefined);
          setMaxWidth(undefined);
          setEnabled(null);
        },
      },
    );
  }

  /** 기본값으로 활성화 */
  function handleActivate() {
    updateMutation.mutate({ domain: host, quality: 85, max_width: 0, enabled: true });
  }

  return (
    <Card data-testid="domain-optimizer-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">최적화 프로파일</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">로드 중...</p>
        ) : isError ? (
          /* API 실패 시 — 자매 컴포넌트(DomainCacheCards #154, DomainOptimizationStats #153)와 동일 패턴.
             "최적화 미설정" 분기로 빠지면 [기본값으로 활성화] 버튼이 노출되어 기존 프로파일을
             기본값으로 덮어쓸 위험이 있으므로, 에러 상태에서는 명시적으로 차단한다 (#246). */
          <p
            className="text-sm text-destructive"
            data-testid="optimizer-error-message"
          >
            최적화 정보를 불러올 수 없습니다
          </p>
        ) : profile ? (
          /* 프로파일 있으면 편집 폼 표시 */
          <div className="space-y-3">
            {/* quality */}
            <div className="space-y-1">
              {/* Label에는 필드 이름만 — 제약 설명은 별도 <p>로 분리 (shadcn/ui 디자인 시스템 원칙) */}
              <Label htmlFor="optimizer-quality" className="text-xs">
                품질
              </Label>
              <Input
                id="optimizer-quality"
                type="number"
                min={1}
                max={100}
                step={1}
                value={qualityDisplay}
                onChange={(e) => {
                  // 빈 문자열은 null로 보존 — Number('')=0 보정으로 인한 dirty 오탐·잘못된 0 저장 방지(#215).
                  const v = e.target.value;
                  setQuality(v === '' ? null : Number(v));
                }}
                className="h-8 text-sm"
                data-testid="optimizer-quality-input"
              />
              <p className="text-xs text-muted-foreground">1–100 사이의 정수</p>
            </div>

            {/* max_width */}
            <div className="space-y-1">
              {/* Label에는 필드 이름만 — 제약 설명은 별도 <p>로 분리 (shadcn/ui 디자인 시스템 원칙) */}
              <Label htmlFor="optimizer-max-width" className="text-xs">
                최대 너비
              </Label>
              <Input
                id="optimizer-max-width"
                type="number"
                min={0}
                max={65535}
                step={1}
                value={maxWidthDisplay}
                onChange={(e) => {
                  // 빈 문자열은 null로 보존 — Number('')=0 보정으로 인한 의도치 않은 max_width=0 저장 방지(#215).
                  const v = e.target.value;
                  setMaxWidth(v === '' ? null : Number(v));
                }}
                className="h-8 text-sm"
                data-testid="optimizer-max-width-input"
              />
              <p className="text-xs text-muted-foreground">
                0–65535 사이의 정수 (0 입력 시 너비 제한 없음)
              </p>
            </div>

            {/* enabled Switch */}
            <div className="flex items-center gap-2">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="optimizer-enabled-switch"
              />
              <Label className="text-sm">활성화</Label>
            </div>

            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || !isDirty}
              size="sm"
              data-testid="optimizer-save-btn"
            >
              {updateMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        ) : (
          /* 프로파일 없으면 안내 + 활성화 버튼 */
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">최적화 미설정</p>
            <p className="text-xs text-muted-foreground">
              이 도메인에 설정된 최적화 프로파일이 없습니다.
            </p>
            <Button
              onClick={handleActivate}
              disabled={updateMutation.isPending}
              size="sm"
              data-testid="optimizer-activate-btn"
            >
              {updateMutation.isPending ? '활성화 중...' : '기본값으로 활성화'}
            </Button>
          </div>
        )}
      </CardContent>

      {/* 미저장 변경 확인 다이얼로그 — useUnsavedChangesPrompt가 SPA 이동을 차단하면 표시.
          OriginSection의 unsaved-changes-dialog와 testid가 겹치지 않도록 별도 testid 사용. */}
      <AlertDialog open={pendingNavigation !== null} onClose={cancelNavigation}>
        <AlertDialogContent
          className="max-w-sm"
          data-testid="optimizer-unsaved-changes-dialog"
        >
          <AlertDialogTitle>저장하지 않은 변경 사항이 있습니다</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            최적화 프로파일에 저장하지 않은 변경 사항이 있습니다. 페이지를 떠나면
            입력한 내용이 사라집니다. 정말 떠나시겠습니까?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={cancelNavigation}
              size="sm"
              data-testid="optimizer-unsaved-cancel-btn"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={confirmNavigation}
              size="sm"
              data-testid="optimizer-unsaved-leave-btn"
            >
              떠나기
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
