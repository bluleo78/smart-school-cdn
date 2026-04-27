/// 도메인 빠른 액션 카드 4개 — 프록시 테스트 / 캐시 퍼지 / TLS 갱신 / 강제 동기화
import { useState } from 'react';
import { Plug, Trash2, ShieldCheck, RefreshCw } from 'lucide-react';
import type { Domain } from '../../../api/domain-types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../../ui/alert-dialog';
import { Input } from '../../ui/input';
import { testProxy } from '../../../api/proxy';
import { usePurgeDomain } from '../../../hooks/usePurgeDomain';
import { useTlsRenew } from '../../../hooks/useTlsRenew';
import { useSyncDomain } from '../../../hooks/useSyncDomain';

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
    /** CDN 관련 주요 응답 헤더 — 서버가 반환한 경우에만 존재 */
    response_headers?: Record<string, string>;
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
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>

        {/* 경로 입력 — shadcn Input으로 디자인 시스템 일관성 유지 */}
        <Input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path/to/resource"
          className="font-mono"
          data-testid="proxy-test-path-input"
        />

        {/* 결과 영역 — HTTP 상태 코드 범위별로 색상·아이콘을 구분한다 */}
        {result && (() => {
          // 네트워크 오류(success=false): 프록시 서버 자체에 연결 불가
          if (!result.success) {
            return (
              <div
                className="rounded-md px-3 py-2 text-sm bg-destructive/10 text-destructive"
                data-testid="proxy-test-result"
              >
                ✗ {result.error || `HTTP ${result.status_code}`}
              </div>
            );
          }
          // 4xx / 5xx — 오류 응답
          if (result.status_code >= 400) {
            return (
              <div
                className="rounded-md px-3 py-2 text-sm bg-destructive/10 text-destructive"
                data-testid="proxy-test-result"
              >
                ✗ {result.status_code} — {result.response_time_ms}ms
              </div>
            );
          }
          // 3xx — 리다이렉트
          if (result.status_code >= 300) {
            return (
              <div
                className="rounded-md px-3 py-2 text-sm bg-warning/10 text-warning"
                data-testid="proxy-test-result"
              >
                ↗ {result.status_code} — {result.response_time_ms}ms
              </div>
            );
          }
          // 2xx — 성공
          return (
            <div
              className="rounded-md px-3 py-2 text-sm bg-success/10 text-success"
              data-testid="proxy-test-result"
            >
              ✓ {result.status_code} — {result.response_time_ms}ms
              {/* 응답 헤더가 있으면 CDN 캐시 상태 확인용으로 목록 표시 */}
              {result.response_headers && Object.keys(result.response_headers).length > 0 && (
                <dl
                  className="mt-2 space-y-0.5 font-mono text-xs"
                  data-testid="proxy-test-headers"
                >
                  {Object.entries(result.response_headers).map(([k, v]) => (
                    <div key={k} className="flex gap-1">
                      <dt className="shrink-0 font-medium">{k}:</dt>
                      <dd className="truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })()}

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
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="text-lg [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <p className="flex-1 text-xs text-muted-foreground">{description}</p>
        <div className="mt-auto">{children}</div>
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
  const tlsRenewMutation = useTlsRenew();
  const syncMutation = useSyncDomain();

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
      {/* mobile-first: 375px 단일 열 → sm(640px) 이상 2열 → lg(1024px) 이상 4열 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="domain-quick-actions">
        {/* 프록시 테스트 */}
        <ActionCard
          icon={<Plug />}
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
          icon={<Trash2 />}
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

        {/* TLS 갱신 — 활성화 */}
        <ActionCard
          icon={<ShieldCheck />}
          title="TLS 갱신"
          description="TLS 인증서를 수동으로 갱신합니다."
        >
          <Button
            onClick={() => tlsRenewMutation.mutate(domain.host)}
            disabled={tlsRenewMutation.isPending}
            data-testid="tls-renew"
          >
            {tlsRenewMutation.isPending ? '갱신 중…' : '갱신'}
          </Button>
        </ActionCard>

        {/* 강제 동기화 — 활성화 */}
        <ActionCard
          icon={<RefreshCw />}
          title="강제 동기화"
          description="Proxy/TLS/DNS 서버에 설정을 즉시 동기화합니다."
        >
          <Button
            onClick={() => syncMutation.mutate(domain.host)}
            disabled={syncMutation.isPending}
            data-testid="force-sync"
          >
            {syncMutation.isPending ? '동기화 중…' : '동기화'}
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
