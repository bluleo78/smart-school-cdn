/**
 * 도메인 관리 페이지 — shadcn 컴포넌트 전면 적용 + UX 개선
 * - Dialog: ESC 키 + 백드롭 클릭 닫기
 * - 삭제/프록시 테스트: try/catch + Sonner 토스트
 * - 추가 성공/실패: Sonner 토스트
 * - 사이드 패널: X 닫기 버튼
 * - Table: 시맨틱 컴포넌트
 */
import { useState } from 'react';
import { X, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { useDomains } from '../hooks/useDomains';
import { useAddDomain } from '../hooks/useAddDomain';
import { useDeleteDomain } from '../hooks/useDeleteDomain';
import { useTestProxy } from '../hooks/useTestProxy';
import type { Domain } from '../api/domains';
import type { ProxyTestResult } from '../api/proxy';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';

// ─── 추가 다이얼로그 ─────────────────────────────────────────────

function AddDomainDialog({ onClose }: { onClose: () => void }) {
  const [host, setHost] = useState('');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const addDomain = useAddDomain();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const h = host.trim();
    const o = origin.trim();
    if (!h || !o) {
      setError('도메인과 원본 URL을 모두 입력해주세요.');
      return;
    }
    if (!o.startsWith('http://') && !o.startsWith('https://')) {
      setError('원본 URL은 http:// 또는 https://로 시작해야 합니다.');
      return;
    }
    try {
      await addDomain.mutateAsync({ host: h, origin: o });
      toast.success(`${h} 도메인이 추가되었습니다.`);
      onClose();
    } catch {
      setError('도메인 추가에 실패했습니다.');
    }
  }

  return (
    <DialogContent data-testid="add-domain-dialog">
      <DialogTitle>도메인 추가</DialogTitle>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="add-host" className="text-xs font-medium text-muted-foreground">
            도메인
          </label>
          <Input
            id="add-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="textbook.com 또는 *.textbook.com"
            data-testid="add-domain-host"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="add-origin" className="text-xs font-medium text-muted-foreground">
            원본 URL
          </label>
          <Input
            id="add-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="https://textbook.com"
            data-testid="add-domain-origin"
          />
        </div>
        {error && (
          <p className="text-xs text-destructive" data-testid="add-domain-error">
            {error}
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

// ─── 삭제 확인 다이얼로그 ────────────────────────────────────────

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

// ─── 사이드 패널 ────────────────────────────────────────────────

function SidePanel({ domain, onDelete, onClose }: { domain: Domain; onDelete: () => void; onClose: () => void }) {
  const [path, setPath] = useState('/');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const testProxy = useTestProxy();

  async function handleTest() {
    setTestResult(null);
    try {
      const result = await testProxy.mutateAsync({
        domain: domain.host.replace(/^\*\./, ''),
        path,
        protocol,
      });
      setTestResult(result);
    } catch {
      toast.error('프록시 테스트 중 오류가 발생했습니다.');
    }
  }

  return (
    <Card
      className="w-72 p-4 space-y-4 overflow-y-auto shrink-0"
      data-testid="domain-side-panel"
    >
      {/* 헤더: 도메인명 + 닫기 버튼 */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono font-semibold text-sm break-all">{domain.host}</p>
          <p className="text-xs text-muted-foreground mt-1 break-all">{domain.origin}</p>
          <p className="text-xs text-muted-foreground mt-1">
            등록: {new Date(domain.created_at * 1000).toLocaleDateString('ko-KR')}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors ml-2 shrink-0"
          aria-label="패널 닫기"
          data-testid="panel-close-button"
        >
          <X size={16} />
        </button>
      </div>

      {/* 프록시 테스트 */}
      <div className="space-y-2">
        <p className="text-xs font-medium">프록시 테스트</p>
        <div className="flex gap-1 rounded-md border border-border w-fit p-0.5 bg-card text-xs">
          {(['http', 'https'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProtocol(p)}
              className={`rounded px-2 py-0.5 transition-colors ${
                protocol === p
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
              data-testid={`panel-protocol-${p}`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path"
          className="text-xs py-1"
          data-testid="panel-test-path"
        />
        <Button
          onClick={handleTest}
          disabled={testProxy.isPending}
          className="w-full text-xs py-1.5"
          data-testid="panel-test-button"
        >
          {testProxy.isPending ? '테스트 중…' : '테스트'}
        </Button>
        {testResult && (
          <div
            className={`rounded text-xs px-2 py-1.5 ${
              testResult.success && testResult.status_code < 400
                ? 'bg-success-subtle text-success'
                : 'bg-destructive/10 text-destructive'
            }`}
            data-testid="panel-test-result"
          >
            {testResult.success && testResult.status_code < 400 ? '✓' : '✗'} HTTP{' '}
            {testResult.status_code} · {testResult.response_time_ms}ms
          </div>
        )}
      </div>

      {/* 삭제 버튼 */}
      <Button
        variant="destructive"
        onClick={onDelete}
        className="w-full text-xs"
        data-testid="panel-delete-button"
      >
        도메인 삭제
      </Button>
    </Card>
  );
}

// ─── 메인 페이지 ────────────────────────────────────────────────

export function DomainsPage() {
  const { data: domains = [], isLoading, error } = useDomains();
  const deleteDomain = useDeleteDomain();
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const selectedDomain = domains.find((d) => d.host === selectedHost) ?? null;

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await deleteDomain.mutateAsync(deleteTarget);
      toast.success(`${deleteTarget} 도메인이 삭제되었습니다.`);
      if (selectedHost === deleteTarget) setSelectedHost(null);
    } catch {
      toast.error('도메인 삭제에 실패했습니다.');
    }
    setDeleteTarget(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 — AppLayout 이 p-6 을 이미 제공하므로 추가 수평 패딩 없음 */}
      <div className="flex items-center justify-between pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">도메인 관리</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            등록된 도메인에 대해 DNS CDN IP 반환 + HTTPS 프록시 + 캐시가 활성화됩니다.
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} data-testid="add-domain-button">
          + 도메인 추가
        </Button>
      </div>

      {/* 본문: 테이블 + 사이드 패널 */}
      <div className="flex flex-1 overflow-hidden gap-4">
        {/* 테이블 Card */}
        <Card className="flex-1 overflow-auto">
          <CardHeader><CardTitle>도메인 목록</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="p-6 space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            )}
            {error && (
              <p className="p-6 text-sm text-destructive">도메인 목록을 불러오지 못했습니다.</p>
            )}
            {!isLoading && !error && domains.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground" data-testid="domains-empty">
                <Globe size={36} className="opacity-30" />
                <p className="text-sm">등록된 도메인이 없습니다.</p>
                <p className="text-xs">우측 상단 "+ 도메인 추가" 버튼으로 첫 번째 도메인을 등록하세요.</p>
              </div>
            )}
            {domains.length > 0 && (
              <Table data-testid="domains-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>도메인</TableHead>
                    <TableHead>원본 URL</TableHead>
                    <TableHead>등록일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow
                      key={domain.host}
                      onClick={() =>
                        setSelectedHost(selectedHost === domain.host ? null : domain.host)
                      }
                      className={`cursor-pointer hover:bg-muted/30 ${
                        selectedHost === domain.host ? 'bg-accent' : ''
                      }`}
                      data-testid={`domain-row-${domain.host}`}
                    >
                      <TableCell className="font-mono font-medium">{domain.host}</TableCell>
                      <TableCell className="text-muted-foreground truncate max-w-xs">
                        {domain.origin}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(domain.created_at * 1000).toLocaleDateString('ko-KR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* 사이드 패널 */}
        {selectedDomain && (
          <SidePanel
            domain={selectedDomain}
            onDelete={() => setDeleteTarget(selectedDomain.host)}
            onClose={() => setSelectedHost(null)}
          />
        )}
      </div>

      {/* 추가 다이얼로그 */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <AddDomainDialog onClose={() => setShowAddDialog(false)} />
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        {deleteTarget && (
          <DeleteConfirmDialog
            host={deleteTarget}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteTarget(null)}
            isPending={deleteDomain.isPending}
          />
        )}
      </AlertDialog>
    </div>
  );
}
