/// 도메인 기본 정보 + TLS 상태 카드 — 2컬럼 레이아웃
import { useMemo } from 'react';
import type { Domain } from '../../../api/domain-types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { useDomainTls } from '../../../hooks/useDomainTls';

interface Props {
  domain: Domain;
}

/** 라벨 + 값 행 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium break-all">{children}</span>
    </div>
  );
}

export function DomainInfoCards({ domain }: Props) {
  const { data: cert } = useDomainTls(domain.host);

  /** TLS 만료까지 남은 일수 계산 — cert가 갱신될 때만 재계산 */
  const daysUntilExpiry = useMemo(() => {
    if (!cert) return null;
    const expires = new Date(cert.expires_at).getTime();
    // eslint-disable-next-line react-hooks/purity -- 만료일 계산에 현재 시간 필요
    return Math.floor((expires - Date.now()) / 86_400_000);
  }, [cert]);

  /** TLS 상태 판별 — 만료/임박/유효/미발급 */
  const tlsStatus = (() => {
    if (daysUntilExpiry === null) return { label: '미발급', ok: false, color: 'text-muted-foreground' };
    if (daysUntilExpiry <= 0) return { label: '만료됨', ok: false, color: 'text-destructive' };
    if (daysUntilExpiry <= 30) return { label: `만료 ${daysUntilExpiry}일 전`, ok: true, color: 'text-warning' };
    return { label: '유효', ok: true, color: 'text-success' };
  })();

  /** 타임스탬프(초) → 한국어 날짜 문자열 */
  const toKoDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('ko-KR');

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 왼쪽: 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoRow label="호스트">{domain.host}</InfoRow>
          <InfoRow label="오리진">{domain.origin}</InfoRow>
          <InfoRow label="설명">{domain.description || '—'}</InfoRow>
          <InfoRow label="생성일">{toKoDate(domain.created_at)}</InfoRow>
          <InfoRow label="수정일">{toKoDate(domain.updated_at)}</InfoRow>
        </CardContent>
      </Card>

      {/* 오른쪽: TLS 상태 — Proxy/DNS 동기화 필드는 백엔드 미지원으로 제거(#72) */}
      <Card>
        <CardHeader>
          <CardTitle>TLS 상태</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoRow label="TLS 상태">
            <span className={tlsStatus.color}>● </span>
            {tlsStatus.label}
          </InfoRow>
          <InfoRow label="TLS 만료일">
            {cert ? new Date(cert.expires_at).toLocaleDateString('ko-KR') : '—'}
          </InfoRow>
        </CardContent>
      </Card>
    </div>
  );
}
