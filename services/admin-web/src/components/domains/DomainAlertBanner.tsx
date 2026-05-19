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

  // 타입별 분리 — host 단위 알림은 도메인 링크, system 알림(disk_high)은 별도 처리
  const tlsHosts  = data.alerts.flatMap((a) => (a.type === 'tls_expiring' ? [a.host] : []));
  const syncHosts = data.alerts.flatMap((a) => (a.type === 'sync_failed'  ? [a.host] : []));
  // 이슈 #432 — storage 디스크 사용률 80% 초과 알림. 다건 emit 되지 않으므로 첫 건만 사용.
  const diskAlert = data.alerts.find((a) => a.type === 'disk_high');

  const parts: string[] = [];
  if (tlsHosts.length > 0)  parts.push(`TLS 만료 임박 ${tlsHosts.length}건`);
  if (syncHosts.length > 0) parts.push(`동기화 실패 ${syncHosts.length}건`);
  if (diskAlert && diskAlert.type === 'disk_high') {
    parts.push(`디스크 사용률 ${diskAlert.usage_ratio}%`);
  }

  // 이슈 #281 — 2단 구조로 위계 명확화.
  // 첫 줄: 아이콘 + '주의' + 카운트 요약 (font-medium, 시각 가중치 최상)
  // 둘째 줄: 타입별 도메인 링크 5개 + '외 N건' (text-xs opacity-70 보조)
  // 좁은 viewport(iPad portrait/landscape) 에서 줄바꿈으로 위계가 평탄해지던 문제 차단.
  return (
    <div
      className="rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning"
      data-testid="domain-alert-banner"
    >
      {/* 첫 줄: 핵심 메시지 */}
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" />
        <span className="font-medium">주의 · {parts.join(' · ')}</span>
      </div>
      {/* 둘째 줄: 도메인 링크 (보조 정보, 작은 글씨) */}
      {(tlsHosts.length > 0 || syncHosts.length > 0 || diskAlert) && (
        <div className="mt-1 pl-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs opacity-70">
          {tlsHosts.length > 0 && (
            <span><AlertLinks hosts={tlsHosts} /></span>
          )}
          {syncHosts.length > 0 && (
            <span><AlertLinks hosts={syncHosts} /></span>
          )}
          {diskAlert && diskAlert.type === 'disk_high' && (
            <Link
              to="/system"
              className="underline underline-offset-2 hover:opacity-80"
              data-testid="domain-alert-link-disk-high"
            >
              스토리지 상세
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
