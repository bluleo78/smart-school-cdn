/// 도메인 경고 배너 — TLS 만료 임박 / 동기화 실패 알림
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { useDomainSummary } from '../../hooks/useDomainSummary';

/** 배너에 표시할 최대 도메인 수 — 이 수를 넘으면 "외 N건" 으로 축약한다 */
const MAX_VISIBLE_LINKS = 5;

/**
 * 알림 도메인 링크 목록을 렌더링한다.
 * - 1건: 해당 도메인 상세 페이지로 직접 링크
 * - 다건: 각 도메인을 개별 링크로 나열(최대 MAX_VISIBLE_LINKS건, 초과 시 "외 N건" 축약)
 */
function AlertLinks({ hosts }: { hosts: string[] }) {
  // MAX_VISIBLE_LINKS 초과분을 축약하여 배너가 넘치지 않도록 한다
  const visible = hosts.slice(0, MAX_VISIBLE_LINKS);
  const overflow = hosts.length - visible.length;

  return (
    <>
      {visible.map((host, idx) => (
        <span key={host}>
          {idx > 0 && <span className="mx-0.5 opacity-60">,</span>}
          <Link
            to={`/domains/${encodeURIComponent(host)}`}
            className="text-xs underline underline-offset-2 hover:opacity-80"
            data-testid={`domain-alert-link-${host}`}
          >
            {host}
          </Link>
        </span>
      ))}
      {overflow > 0 && (
        <span className="ml-0.5 text-xs opacity-70"> 외 {overflow}건</span>
      )}
    </>
  );
}

export function DomainAlertBanner() {
  const { data } = useDomainSummary();

  // alerts 가 비어있으면 렌더링 안함
  if (!data?.alerts || data.alerts.length === 0) return null;

  // 타입별 호스트 목록 분리 — 각 타입의 도메인에 개별 링크를 제공하기 위함
  const tlsHosts = data.alerts.filter((a) => a.type === 'tls_expiring').map((a) => a.host);
  const syncHosts = data.alerts.filter((a) => a.type === 'sync_failed').map((a) => a.host);

  const parts: string[] = [];
  if (tlsHosts.length > 0) parts.push(`TLS 만료 임박 ${tlsHosts.length}건`);
  if (syncHosts.length > 0) parts.push(`동기화 실패 ${syncHosts.length}건`);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning"
      data-testid="domain-alert-banner"
    >
      <AlertTriangle size={16} className="shrink-0" />
      <span className="font-medium">주의: </span>
      <span className="flex-1">{parts.join(' · ')}</span>
      {/* TLS 만료 임박 도메인 링크 — 타입별로 각 도메인을 개별 접근 가능하게 나열 */}
      {tlsHosts.length > 0 && (
        <span className="shrink-0">
          <AlertLinks hosts={tlsHosts} />
        </span>
      )}
      {/* 동기화 실패 도메인 링크 */}
      {syncHosts.length > 0 && (
        <span className="shrink-0">
          <AlertLinks hosts={syncHosts} />
        </span>
      )}
    </div>
  );
}
