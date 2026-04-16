/// 도메인 빠른 액션 카드 4개 — 프록시 테스트 / 캐시 퍼지 / TLS 갱신 / 강제 동기화
import { useState } from 'react';
import type { Domain } from '../../../api/domain-types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../ui/alert-dialog';
import { testProxy } from '../../../api/proxy';
import { usePurgeDomain } from '../../../hooks/usePurgeDomain';

interface Props {
  domain: Domain;
}

// ─────────────────────────────────────────────
// 프록시 테스트 다이얼로그
// ─────────────────────────────────────────────
function ProxyTestDialog({
  open,
  onClose,
  domain,
}: {
  open: boolean;
  onClose: () => void;
  domain: Domain;
}) {
  const [protocol, setProtocol] = useState<'http' | 'https'>('https');
  const [path, setPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    status_code: number;
    response_time_ms: number;
    error?: string;
  } | null>(null);

  /** 테스트 요청 전송 */
  async function handleTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await testProxy(domain.host, path, protocol);
      setResult(res);
    } catch {
      setResult({ success: false, status_code: 0, response_time_ms: 0, error: '요청 실패' });
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setResult(null);
    setPath('/');
    setProtocol('https');
    onClose();
  }

  return (
    <AlertDialog open={open} onClose={handleClose}>
      <AlertDialogContent className="max-w-md" data-testid="proxy-test-dialog">
        <AlertDialogTitle>프록시 테스트</AlertDialogTitle>
        <p className="text-sm text-muted-foreground">{domain.host}에 직접 요청을 전송합니다.</p>

        {/* 프로토콜 선택 */}
        <div className="flex gap-2">
          {(['https', 'http'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProtocol(p)}
              aria-pressed={protocol === p}
              className={`px-3 py-1 rounded text-xs border ${
                protocol === p
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>

        {/* 경로 입력 */}
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path/to/resource"
          className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
          data-testid="proxy-test-path-input"
        />

        {/* 결과 영역 */}
        {result && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              result.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            }`}
            data-testid="proxy-test-result"
          >
            {result.success ? (
              <>
                ✓ {result.status_code} — {result.response_time_ms}ms
              </>
            ) : (
              <>✗ {result.error || `HTTP ${result.status_code}`}</>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button onClick={handleTest} disabled={loading} data-testid="proxy-test-submit">
            {loading ? '테스트 중…' : '테스트'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────────────────────────────────────
// 캐시 퍼지 확인 다이얼로그
// ─────────────────────────────────────────────
function PurgeConfirmDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <AlertDialog open={open} onClose={onClose}>
      <AlertDialogContent className="max-w-sm" data-testid="purge-confirm-dialog">
        <AlertDialogTitle>캐시 퍼지</AlertDialogTitle>
        <p className="text-sm text-muted-foreground">
          이 도메인의 전체 캐시를 삭제합니다. 계속하시겠습니까?
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="purge-confirm-submit"
          >
            {isPending ? '퍼지 중…' : '퍼지'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────────────────────────────────────
// 액션 카드 공통 컴포넌트
// ─────────────────────────────────────────────
function ActionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card variant="glass" className="flex flex-col gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="text-lg">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-xs text-muted-foreground">{description}</p>
        {children}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export function DomainQuickActions({ domain }: Props) {
  const [proxyTestOpen, setProxyTestOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const purgeMutation = usePurgeDomain();

  async function handlePurgeConfirm() {
    try {
      await purgeMutation.mutateAsync(domain.host);
      setPurgeOpen(false);
    } catch {
      // 오류 토스트는 훅에서 처리
    }
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-4" data-testid="domain-quick-actions">
        {/* 프록시 테스트 */}
        <ActionCard
          icon="🔌"
          title="프록시 테스트"
          description="지정 경로로 실제 프록시 요청을 전송하고 응답을 확인합니다."
        >
          <Button
            onClick={() => setProxyTestOpen(true)}
            data-testid="proxy-test-open"
          >
            테스트
          </Button>
        </ActionCard>

        {/* 캐시 퍼지 */}
        <ActionCard
          icon="🗑️"
          title="캐시 퍼지"
          description="이 도메인의 전체 캐시를 즉시 삭제합니다."
        >
          <Button
            variant="destructive"
            onClick={() => setPurgeOpen(true)}
            data-testid="purge-cache-open"
          >
            퍼지
          </Button>
        </ActionCard>

        {/* TLS 갱신 — 1차 비활성 */}
        <ActionCard
          icon="🔒"
          title="TLS 갱신"
          description="TLS 인증서를 수동으로 갱신합니다."
        >
          <Button disabled>
            추후 지원
          </Button>
        </ActionCard>

        {/* 강제 동기화 — 1차 비활성 */}
        <ActionCard
          icon="🔄"
          title="강제 동기화"
          description="Proxy 서버에 설정을 즉시 동기화합니다."
        >
          <Button disabled>
            추후 지원
          </Button>
        </ActionCard>
      </div>

      {/* 다이얼로그 */}
      <ProxyTestDialog
        open={proxyTestOpen}
        onClose={() => setProxyTestOpen(false)}
        domain={domain}
      />
      <PurgeConfirmDialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={handlePurgeConfirm}
        isPending={purgeMutation.isPending}
      />
    </>
  );
}
