/// 도메인 경고 배너 — TLS 만료 임박 / 동기화 실패 알림
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { useDomainSummary } from '../../hooks/useDomainSummary';

export function DomainAlertBanner() {
  const { data } = useDomainSummary();

  // alerts 가 비어있으면 렌더링 안함
  if (!data?.alerts || data.alerts.length === 0) return null;

  // 타입별 카운트 집계
  const tlsCount = data.alerts.filter((a) => a.type === 'tls_expiring').length;
  const syncCount = data.alerts.filter((a) => a.type === 'sync_failed').length;

  // 자세히 보기 링크 대상 — 첫 번째 알림의 host
  const firstHost = data.alerts[0].host;

  const parts: string[] = [];
  if (tlsCount > 0) parts.push(`TLS 만료 임박 ${tlsCount}건`);
  if (syncCount > 0) parts.push(`동기화 실패 ${syncCount}건`);

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning"
      data-testid="domain-alert-banner"
    >
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">
        <span className="font-medium">주의: </span>
        {parts.join(' · ')}
      </span>
      <Link
        to={`/domains/${encodeURIComponent(firstHost)}`}
        className="shrink-0 text-xs underline underline-offset-2 hover:opacity-80"
        data-testid="domain-alert-link"
      >
        자세히 보기
      </Link>
    </div>
  );
}
