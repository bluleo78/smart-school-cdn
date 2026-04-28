/// 도메인 설정 탭 — 캐시 퍼지 섹션 (URL 퍼지 / 도메인 전체 퍼지)
import { useState } from 'react';
import { toast } from 'sonner';
import { usePurgeCache } from '../../../hooks/usePurgeCache';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../ui/alert-dialog';

interface Props {
  host: string;
}

export function DomainCacheSection({ host }: Props) {
  /** URL 퍼지 입력값 */
  const [urlInput, setUrlInput] = useState('');
  /** 도메인 전체 퍼지 확인 다이얼로그 열림 여부 */
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);

  const purgeMutation = usePurgeCache();

  /** URL 퍼지 실행 — 입력 URL의 hostname이 현재 도메인과 일치하는지 검증 후 전송한다 */
  async function handleUrlPurge() {
    if (!urlInput.trim()) return;

    // 입력값을 URL로 파싱하여 hostname을 추출한다.
    // 파싱 실패 또는 hostname 불일치 시 서버 요청 없이 인라인 에러로 처리한다.
    let parsedHost: string;
    try {
      parsedHost = new URL(urlInput.trim()).hostname;
    } catch {
      toast.error('유효한 URL을 입력해 주세요.');
      return;
    }
    if (parsedHost !== host) {
      toast.error(`퍼지 URL은 ${host} 도메인 소속이어야 합니다.`);
      return;
    }

    try {
      const result = await purgeMutation.mutateAsync({ type: 'url', target: urlInput.trim() });
      toast.success(`퍼지 완료 — ${result.purged_count}건 삭제`);
      setUrlInput('');
    } catch {
      toast.error('캐시 퍼지에 실패했습니다.');
    }
  }

  /** 도메인 전체 퍼지 실행 — purgeMutation.mutateAsync 사용으로 loading 상태 관리 및 캐시 무효화(stats/popular) 보장.
   *  다이얼로그는 요청 완료(성공/실패) 후에 닫아 pending 중 재클릭을 isPending disabled로 차단한다. */
  async function handleDomainPurge() {
    try {
      const result = await purgeMutation.mutateAsync({ type: 'domain', target: host });
      setPurgeDialogOpen(false);
      toast.success(`도메인 캐시 퍼지 완료 — ${result.purged_count}건 삭제`);
    } catch {
      // 실패 시 다이얼로그를 유지하여 사용자가 재시도할 수 있도록 한다
      toast.error('캐시 퍼지에 실패했습니다.');
    }
  }

  return (
    <Card data-testid="domain-cache-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">캐시 퍼지</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* URL 퍼지 */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">URL 퍼지</Label>
          <div className="flex gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/path/to/resource"
              className="h-8 text-sm flex-1"
              data-testid="url-purge-input"
            />
            <Button
              onClick={handleUrlPurge}
              disabled={purgeMutation.isPending || !urlInput.trim()}
              size="sm"
              className="shrink-0"
              data-testid="url-purge-btn"
            >
              퍼지
            </Button>
          </div>
        </div>

        {/* 도메인 전체 퍼지 */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">도메인 전체 퍼지</Label>
          <p className="text-xs text-muted-foreground">
            <strong>{host}</strong>의 모든 캐시 항목을 삭제합니다.
          </p>
          <Button
            variant="destructive"
            onClick={() => setPurgeDialogOpen(true)}
            size="sm"
            data-testid="domain-purge-btn"
          >
            도메인 캐시 퍼지
          </Button>
        </div>
      </CardContent>

      {/* 도메인 전체 퍼지 확인 다이얼로그 — 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={purgeDialogOpen} onClose={() => { if (!purgeMutation.isPending) setPurgeDialogOpen(false); }}>
        <AlertDialogContent className="max-w-sm" data-testid="domain-purge-dialog" disableClose={purgeMutation.isPending}>
          <AlertDialogTitle>도메인 캐시 퍼지</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <strong>{host}</strong>의 전체 캐시를 삭제합니다. 계속하시겠습니까?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setPurgeDialogOpen(false)}
              size="sm"
              disabled={purgeMutation.isPending}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDomainPurge}
              disabled={purgeMutation.isPending}
              size="sm"
              data-testid="domain-purge-confirm-btn"
            >
              퍼지
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
