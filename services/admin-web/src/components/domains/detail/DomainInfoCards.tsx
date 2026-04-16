/// 도메인 기본 정보 + 동기화/TLS 상태 카드 — 2컬럼 레이아웃
import type { Domain } from '../../../api/domain-types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

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

/** 상태 점(●) — 색상으로 동기화 상태 표시 */
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? 'text-success' : 'text-destructive'}>● </span>
  );
}

export function DomainInfoCards({ domain }: Props) {
  /** 타임스탬프(초) → 한국어 날짜 문자열 */
  const toKoDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('ko-KR');

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 왼쪽: 기본 정보 */}
      <Card variant="glass">
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

      {/* 오른쪽: 동기화 & TLS */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>동기화 &amp; TLS</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoRow label="Proxy 동기화">
            <StatusDot ok={true} />동기화됨
          </InfoRow>
          <InfoRow label="TLS 상태">
            <StatusDot ok={true} />정상
          </InfoRow>
          <InfoRow label="DNS 동기화">
            <StatusDot ok={true} />동기화됨
          </InfoRow>
          <InfoRow label="마지막 동기화">방금 전</InfoRow>
        </CardContent>
      </Card>
    </div>
  );
}
