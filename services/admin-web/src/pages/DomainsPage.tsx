/**
 * 도메인 관리 페이지
 * 등록된 프록시 도메인을 확인하고 프록시 경유 테스트 요청을 전송한다.
 * Phase 4에서 도메인 CRUD 기능이 추가될 예정이다.
 */
import { useState } from 'react';
import { type ProxyTestResult } from '../api/proxy';
import { useTestProxy } from '../hooks/useTestProxy';

/** 테스트에 사용할 사전 등록 도메인 목록 (Phase 4에서 API로 대체 예정) */
const DEFAULT_DOMAINS = ['httpbin.org'];

export function DomainsPage() {
  const [domain, setDomain] = useState(DEFAULT_DOMAINS[0]);
  const [path, setPath] = useState('/get');
  const [result, setResult] = useState<ProxyTestResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const testProxy = useTestProxy();

  /** 프록시 테스트 요청 전송 — 성공 시 프록시/캐시 쿼리 자동 갱신 */
  async function handleTest() {
    if (!domain.trim() || !path.trim()) return;
    setResult(null);
    setErrorMsg(null);
    try {
      const data = await testProxy.mutateAsync({ domain: domain.trim(), path: path.trim() });
      setResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '요청 실패');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">도메인 관리</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          프록시 경유 테스트로 도메인 연결 상태를 확인합니다.
        </p>
      </div>

      {/* 등록된 도메인 목록 */}
      <section className="rounded-lg border p-4">
        <h3 className="font-semibold mb-3">등록된 도메인</h3>
        <ul className="space-y-2">
          {DEFAULT_DOMAINS.map((d) => (
            <li
              key={d}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <span className="font-mono">{d}</span>
              <span className="text-xs text-muted-foreground">등록됨</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 프록시 테스트 */}
      <section className="rounded-lg border p-4 space-y-4">
        <h3 className="font-semibold">프록시 테스트</h3>
        <p className="text-sm text-muted-foreground">
          선택한 도메인과 경로로 프록시를 통해 실제 요청을 전송하고 결과를 확인합니다.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          {/* 도메인 입력 */}
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-muted-foreground">도메인</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="httpbin.org"
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="proxy-test-domain"
            />
          </div>

          {/* 경로 입력 */}
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-muted-foreground">경로</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/get"
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="proxy-test-path"
            />
          </div>

          {/* 테스트 버튼 — self-end로 인접 입력 필드 하단에 정렬 */}
          <div className="flex flex-col justify-end">
            <button
              onClick={handleTest}
              disabled={testProxy.isPending || !domain.trim() || !path.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="proxy-test-button"
            >
              {testProxy.isPending ? '테스트 중…' : '테스트'}
            </button>
          </div>
        </div>

        {/* 테스트 결과 */}
        {result && (
          <div
            className={`rounded-md border px-4 py-3 text-sm space-y-1 ${
              result.success && result.status_code < 400
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
            data-testid="proxy-test-result"
          >
            <div className="flex items-center gap-2 font-medium">
              <span>{result.success && result.status_code < 400 ? '✓ 성공' : '✗ 실패'}</span>
              {result.status_code > 0 && (
                <span className="font-mono">HTTP {result.status_code}</span>
              )}
            </div>
            <div className="text-xs opacity-80">응답 시간: {result.response_time_ms}ms</div>
            {result.error && <div className="text-xs opacity-80">오류: {result.error}</div>}
          </div>
        )}

        {errorMsg && (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            data-testid="proxy-test-error"
          >
            요청 실패: {errorMsg}
          </div>
        )}
      </section>
    </div>
  );
}
