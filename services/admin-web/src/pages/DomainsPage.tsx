/**
 * 도메인 관리 페이지
 * 레이아웃: 좌측 테이블 + 우측 사이드 패널 (선택된 도메인 상세)
 * 기능: 도메인 추가 다이얼로그, 삭제 확인, 프록시 테스트
 */
import { useState } from 'react';
import { useDomains } from '../hooks/useDomains';
import { useAddDomain } from '../hooks/useAddDomain';
import { useDeleteDomain } from '../hooks/useDeleteDomain';
import { useTestProxy } from '../hooks/useTestProxy';
import type { Domain } from '../api/domains';
import type { ProxyTestResult } from '../api/proxy';

// ─── 추가 다이얼로그 ─────────────────────────────────────────────

interface AddDomainDialogProps {
  onClose: () => void;
}

function AddDomainDialog({ onClose }: AddDomainDialogProps) {
  const [host, setHost] = useState('');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const addDomain = useAddDomain();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const h = host.trim();
    const o = origin.trim();
    if (!h || !o) { setError('도메인과 원본 URL을 모두 입력해주세요.'); return; }
    if (!o.startsWith('http://') && !o.startsWith('https://')) {
      setError('원본 URL은 http:// 또는 https://로 시작해야 합니다.'); return;
    }
    try {
      await addDomain.mutateAsync({ host: h, origin: o });
      onClose();
    } catch {
      setError('도메인 추가에 실패했습니다.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 space-y-4" data-testid="add-domain-dialog">
        <h3 className="text-lg font-semibold">도메인 추가</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">도메인</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="textbook.com 또는 *.textbook.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="add-domain-host"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">원본 URL</label>
            <input
              type="text"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://textbook.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="add-domain-origin"
            />
          </div>
          {error && <p className="text-xs text-red-600" data-testid="add-domain-error">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
              취소
            </button>
            <button type="submit" disabled={addDomain.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              data-testid="add-domain-submit">
              {addDomain.isPending ? '추가 중…' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 삭제 확인 다이얼로그 ────────────────────────────────────────

interface DeleteConfirmDialogProps {
  host: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function DeleteConfirmDialog({ host, onConfirm, onCancel, isPending }: DeleteConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 space-y-4" data-testid="delete-domain-dialog">
        <h3 className="text-lg font-semibold">도메인 삭제</h3>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-medium">{host}</span>을(를) 삭제하시겠습니까?
          DNS 오버라이드와 캐시가 함께 해제됩니다.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            취소
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            data-testid="delete-domain-confirm">
            {isPending ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 사이드 패널 ────────────────────────────────────────────────

interface SidePanelProps {
  domain: Domain;
  onDelete: () => void;
}

function SidePanel({ domain, onDelete }: SidePanelProps) {
  const [path, setPath] = useState('/');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const testProxy = useTestProxy();

  async function handleTest() {
    setTestResult(null);
    const result = await testProxy.mutateAsync({
      domain: domain.host.replace(/^\*\./, ''),
      path,
      protocol,
    });
    setTestResult(result);
  }

  return (
    <div className="w-72 border-l bg-muted/20 p-4 space-y-4 overflow-y-auto" data-testid="domain-side-panel">
      <div>
        <p className="font-mono font-semibold text-sm break-all">{domain.host}</p>
        <p className="text-xs text-muted-foreground mt-1 break-all">{domain.origin}</p>
        <p className="text-xs text-muted-foreground mt-1">
          등록: {new Date(domain.created_at * 1000).toLocaleDateString('ko-KR')}
        </p>
      </div>

      {/* 프록시 테스트 */}
      <div className="space-y-2">
        <p className="text-xs font-medium">프록시 테스트</p>
        <div className="flex gap-1 rounded-md border w-fit p-0.5 bg-white text-xs">
          {(['http', 'https'] as const).map((p) => (
            <button key={p} onClick={() => setProtocol(p)}
              className={`rounded px-2 py-0.5 transition-colors ${protocol === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              data-testid={`panel-protocol-${p}`}>
              {p.toUpperCase()}
            </button>
          ))}
        </div>
        <input type="text" value={path} onChange={(e) => setPath(e.target.value)}
          placeholder="/path"
          className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="panel-test-path" />
        <button onClick={handleTest} disabled={testProxy.isPending}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          data-testid="panel-test-button">
          {testProxy.isPending ? '테스트 중…' : '테스트'}
        </button>
        {testResult && (
          <div className={`rounded text-xs px-2 py-1.5 ${testResult.success && testResult.status_code < 400 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
            data-testid="panel-test-result">
            {testResult.success && testResult.status_code < 400 ? '✓' : '✗'} HTTP {testResult.status_code} · {testResult.response_time_ms}ms
          </div>
        )}
      </div>

      {/* 삭제 버튼 */}
      <button onClick={onDelete}
        className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
        data-testid="panel-delete-button">
        도메인 삭제
      </button>
    </div>
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

  function handleDeleteRequest(host: string) {
    setDeleteTarget(host);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    await deleteDomain.mutateAsync(deleteTarget);
    if (selectedHost === deleteTarget) setSelectedHost(null);
    setDeleteTarget(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-6 pb-4">
        <div>
          <h2 className="text-2xl font-bold">도메인 관리</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            등록된 도메인에 대해 DNS CDN IP 반환 + HTTPS 프록시 + 캐시가 활성화됩니다.
          </p>
        </div>
        <button onClick={() => setShowAddDialog(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          data-testid="add-domain-button">
          + 도메인 추가
        </button>
      </div>

      {/* 본문: 테이블 + 사이드 패널 */}
      <div className="flex flex-1 overflow-hidden border-t">
        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <p className="p-6 text-sm text-muted-foreground">로딩 중…</p>
          )}
          {error && (
            <p className="p-6 text-sm text-red-600">도메인 목록을 불러오지 못했습니다.</p>
          )}
          {!isLoading && !error && domains.length === 0 && (
            <div className="p-6 text-center" data-testid="domains-empty">
              <p className="text-sm text-muted-foreground">등록된 도메인이 없습니다.</p>
              <p className="text-xs text-muted-foreground mt-1">
                + 도메인 추가 버튼으로 첫 번째 도메인을 등록하세요.
              </p>
            </div>
          )}
          {domains.length > 0 && (
            <table className="w-full text-sm" data-testid="domains-table">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-6 py-3 text-left font-medium">도메인</th>
                  <th className="px-6 py-3 text-left font-medium">원본 URL</th>
                  <th className="px-6 py-3 text-left font-medium">등록일</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((domain) => (
                  <tr
                    key={domain.host}
                    onClick={() => setSelectedHost(
                      selectedHost === domain.host ? null : domain.host,
                    )}
                    className={`border-b cursor-pointer transition-colors hover:bg-muted/30 ${selectedHost === domain.host ? 'bg-blue-50' : ''}`}
                    data-testid={`domain-row-${domain.host}`}
                  >
                    <td className="px-6 py-3 font-mono font-medium">{domain.host}</td>
                    <td className="px-6 py-3 text-muted-foreground truncate max-w-xs">{domain.origin}</td>
                    <td className="px-6 py-3 text-muted-foreground text-xs">
                      {new Date(domain.created_at * 1000).toLocaleDateString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 사이드 패널 */}
        {selectedDomain && (
          <SidePanel
            domain={selectedDomain}
            onDelete={() => handleDeleteRequest(selectedDomain.host)}
          />
        )}
      </div>

      {/* 다이얼로그 */}
      {showAddDialog && <AddDomainDialog onClose={() => setShowAddDialog(false)} />}
      {deleteTarget && (
        <DeleteConfirmDialog
          host={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteDomain.isPending}
        />
      )}
    </div>
  );
}
