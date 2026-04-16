/// 도메인 설정 탭 — Origin 편집, TLS 정보, 위험 영역(삭제)
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Domain } from '../../../api/domain-types';
import { useUpdateDomain } from '../../../hooks/useUpdateDomain';
import { useDeleteDomain } from '../../../hooks/useDeleteDomain';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog';

interface Props {
  domain: Domain;
}

export function DomainSettingsTab({ domain }: Props) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="domain-settings-tab">
      {/* 1. Origin 설정 */}
      <OriginSection domain={domain} />

      {/* 2. TLS / 인증서 */}
      <TlsSection />

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

  /** 편집 취소 — 원래 값으로 복원 */
  function handleCancel() {
    setOrigin(domain.origin);
    setDescription(domain.description);
    setEditing(false);
  }

  /** 저장 — 뮤테이션 후 편집 모드 해제 */
  function handleSave() {
    updateMutation.mutate(
      { host: domain.host, body: { origin, description } },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <Card variant="glass">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Origin 설정</CardTitle>
        {!editing && (
          <Button
            variant="outline"
            onClick={() => setEditing(true)}
            data-testid="edit-domain-btn"
            className="h-7 text-xs py-1 px-3"
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
          <>
            {/* Origin 입력 */}
            <div className="space-y-1">
              <Label htmlFor="origin-input" className="text-xs text-muted-foreground">
                오리진
              </Label>
              <Input
                id="origin-input"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                data-testid="origin-input"
                className="h-8 text-sm"
              />
            </div>

            {/* 설명 입력 */}
            <div className="space-y-1">
              <Label htmlFor="description-input" className="text-xs text-muted-foreground">
                설명
              </Label>
              <Input
                id="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            {/* 저장 / 취소 버튼 */}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="save-domain-btn"
                className="h-7 text-xs py-1 px-3"
              >
                {updateMutation.isPending ? '저장 중...' : '저장'}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateMutation.isPending}
                className="h-7 text-xs py-1 px-3"
              >
                취소
              </Button>
            </div>
          </>
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
    </Card>
  );
}

/** TLS / 인증서 카드 — 읽기 전용 정적 표시 */
function TlsSection() {
  return (
    <Card variant="glass">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">TLS / 인증서</CardTitle>
        {/* 1차 릴리스에서는 수동 갱신 비활성화 */}
        <Button variant="outline" disabled className="h-7 text-xs py-1 px-3">
          수동 갱신
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <TlsRow label="상태">
            <span className="text-green-400">유효</span>
          </TlsRow>
          <TlsRow label="발급자">자동 발급</TlsRow>
          <TlsRow label="만료일">정보 없음</TlsRow>
          <TlsRow label="마지막 갱신">정보 없음</TlsRow>
        </div>
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
    });
  }

  return (
    <Card variant="glass" className="border border-destructive/50">
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
          className="h-8 text-xs py-1 px-3"
        >
          도메인 삭제
        </Button>
      </CardContent>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogContent>
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
              className="py-1 px-3 text-sm"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="py-1 px-3 text-sm"
            >
              {deleteMutation.isPending ? '삭제 중...' : '삭제'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
