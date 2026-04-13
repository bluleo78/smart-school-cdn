/// 캐시 관리 페이지 — Card·AlertDialog·Input·Skeleton·Sonner·에러·반응형
import { useState, useRef, useEffect } from 'react';
import { Database } from 'lucide-react';
import { toast } from 'sonner';
import { useCacheStats } from '../hooks/useCacheStats';
import { useCachePopular } from '../hooks/useCachePopular';
import { usePurgeCache } from '../hooks/usePurgeCache';
import { formatBytes } from '../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

type PurgeTab = 'url' | 'domain' | 'all';

const TAB_LABELS: Record<PurgeTab, string> = {
  url: 'URL 퍼지',
  domain: '도메인 퍼지',
  all: '전체 퍼지',
};

export function CachePage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useCacheStats();
  const { data: popular, isLoading: popularLoading, error: popularError } = useCachePopular();
  const purge = usePurgeCache();

  const [activeTab, setActiveTab] = useState<PurgeTab>('url');
  const [urlInput, setUrlInput] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  // E2E 테스트용 상태 토스트 — data-testid="purge-toast" 유지
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(msg: string) {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  }

  async function handleConfirmPurge() {
    setShowConfirm(false);
    try {
      const req =
        activeTab === 'url'
          ? { type: 'url' as const, target: urlInput }
          : activeTab === 'domain'
            ? { type: 'domain' as const, target: domainInput }
            : { type: 'all' as const };
      const result = await purge.mutateAsync(req);
      const msg = `퍼지 완료 — ${result.purged_count}건 삭제, ${formatBytes(result.freed_bytes)} 해제`;
      toast.success(msg);
      showToast(msg);
      setUrlInput('');
      setDomainInput('');
    } catch {
      const msg = '퍼지 실패: 서버에 연결할 수 없습니다.';
      toast.error(msg);
      showToast(msg);
    }
  }

  const isPurgeDisabled =
    purge.isPending ||
    (activeTab === 'url' && !urlInput.trim()) ||
    (activeTab === 'domain' && !domainInput.trim());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">캐시 관리</h2>
        <p className="text-sm text-muted-foreground mt-1">캐시 통계 확인 및 퍼지를 실행합니다.</p>
      </div>

      {/* E2E 테스트용 상태 토스트 — sonner와 병행 */}
      {toastMsg && (
        <div
          className="fixed bottom-4 right-4 bg-foreground text-background text-sm px-4 py-3 rounded-lg shadow-lg z-50"
          data-testid="purge-toast"
        >
          {toastMsg}
        </div>
      )}

      {/* 통계 카드 — 모바일 1열, sm 이상 3열 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>총 캐시 항목</CardTitle></CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-20" /> :
             statsError ? <p className="text-sm text-destructive">오류</p> :
             <p className="text-xl font-bold">{(stats?.entry_count ?? 0).toLocaleString()}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>사용량</CardTitle></CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-24" /> :
             statsError ? <p className="text-sm text-destructive">오류</p> :
             <p className="text-xl font-bold">{formatBytes(stats?.total_size_bytes ?? 0)}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>히트율</CardTitle></CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-16" /> :
             statsError ? <p className="text-sm text-destructive">오류</p> :
             <p className="text-xl font-bold text-primary">{(stats?.hit_rate ?? 0).toFixed(1)}%</p>}
          </CardContent>
        </Card>
      </div>

      {/* 퍼지 패널 */}
      <Card>
        <CardHeader><CardTitle>캐시 퍼지</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* 탭 */}
          <div className="flex border-b border-border">
            {(['url', 'domain', 'all'] as PurgeTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {activeTab === 'url' && (
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://cdn.textbook.com/images/cover.png"
                data-testid="url-input"
              />
              <Button
                variant="destructive"
                onClick={() => setShowConfirm(true)}
                disabled={isPurgeDisabled}
                className="shrink-0"
                data-testid="purge-btn"
              >
                퍼지
              </Button>
            </div>
          )}

          {activeTab === 'domain' && (
            <div className="flex gap-2">
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="cdn.textbook.com"
                data-testid="domain-input"
              />
              <Button
                variant="destructive"
                onClick={() => setShowConfirm(true)}
                disabled={isPurgeDisabled}
                className="shrink-0"
                data-testid="purge-btn"
              >
                퍼지
              </Button>
            </div>
          )}

          {activeTab === 'all' && (
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                모든 캐시 항목({(stats?.entry_count ?? 0).toLocaleString()}건)을 삭제합니다.
              </p>
              <Button
                variant="destructive"
                onClick={() => setShowConfirm(true)}
                disabled={purge.isPending}
                data-testid="purge-btn"
              >
                전체 퍼지
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 인기 콘텐츠 */}
      <Card>
        <CardHeader><CardTitle>인기 콘텐츠</CardTitle></CardHeader>
        <CardContent>
          {popularLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : popularError ? (
            <p className="text-sm text-destructive">인기 콘텐츠를 불러오지 못했습니다.</p>
          ) : !popular || popular.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Database size={32} className="opacity-30" />
              <p className="text-sm">캐시된 콘텐츠가 없습니다.</p>
              <p className="text-xs">프록시를 통해 요청이 들어오면 여기에 표시됩니다.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>크기</TableHead>
                  <TableHead>히트 수</TableHead>
                  <TableHead>도메인</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {popular.map((item) => (
                  <TableRow key={item.url}>
                    <TableCell className="font-mono max-w-xs truncate">{item.url}</TableCell>
                    <TableCell className="text-muted-foreground">{formatBytes(item.size_bytes)}</TableCell>
                    <TableCell className="font-semibold">{item.hit_count.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{item.domain}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 퍼지 확인 AlertDialog */}
      <AlertDialog open={showConfirm} onClose={() => setShowConfirm(false)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogTitle>퍼지 확인</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            {activeTab === 'all'
              ? '전체 캐시를 삭제합니다. 계속하시겠습니까?'
              : activeTab === 'url'
                ? `"${urlInput}" 캐시를 삭제합니다.`
                : `"${domainInput}" 도메인 캐시를 모두 삭제합니다.`}
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleConfirmPurge} data-testid="confirm-purge-btn">
              퍼지 실행
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
