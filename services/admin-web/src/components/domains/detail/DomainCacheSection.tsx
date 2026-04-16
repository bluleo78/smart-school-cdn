/// 도메인 설정 탭 — 캐시 퍼지 섹션 (URL 퍼지 / 도메인 전체 퍼지)
import { useState } from 'react';
import { toast } from 'sonner';
import { purgeCache } from '../../../api/cache';
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

  /** URL 퍼지 실행 */
  async function handleUrlPurge() {
    if (!urlInput.trim()) return;
    try {
      const result = await purgeMutation.mutateAsync({ type: 'url', target: urlInput.trim() });
      toast.success(`퍼지 완료 — ${result.purged_count}건 삭제`);
      setUrlInput('');
    } catch {
      toast.error('퍼지 실패: 서버에 연결할 수 없습니다.');
    }
  }

  /** 도메인 전체 퍼지 실행 */
  async function handleDomainPurge() {
    setPurgeDialogOpen(false);
    try {
      const result = await purgeCache({ type: 'domain', target: host });
      toast.success(`도메인 캐시 퍼지 완료 — ${result.purged_count}건 삭제`);
    } catch {
      toast.error('퍼지 실패: 서버에 연결할 수 없습니다.');
    }
  }

  return (
    <Card variant="glass" data-testid="domain-cache-section">
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
              className="h-8 text-xs py-1 px-3 shrink-0"
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
            className="h-8 text-xs py-1 px-3"
            data-testid="domain-purge-btn"
          >
            도메인 캐시 퍼지
          </Button>
        </div>
      </CardContent>

      {/* 도메인 전체 퍼지 확인 다이얼로그 */}
      <AlertDialog open={purgeDialogOpen} onClose={() => setPurgeDialogOpen(false)}>
        <AlertDialogContent className="max-w-sm" data-testid="domain-purge-dialog">
          <AlertDialogTitle>도메인 캐시 퍼지</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <strong>{host}</strong>의 전체 캐시를 삭제합니다. 계속하시겠습니까?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setPurgeDialogOpen(false)}
              className="py-1 px-3 text-sm"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDomainPurge}
              className="py-1 px-3 text-sm"
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
