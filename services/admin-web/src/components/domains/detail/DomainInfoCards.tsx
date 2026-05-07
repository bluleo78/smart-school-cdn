/// 도메인 기본 정보 + TLS 상태 카드 — 반응형 그리드 (모바일 1열 → md 이상 2열)
import type { Domain } from '../../../api/domain-types';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { useDomainTls } from '../../../hooks/useDomainTls';
import { TlsStatusBadge } from '../../TlsStatusBadge';

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
  // isError를 함께 destructure하여 인증서 조회 실패 시 '미발급' 거짓 표시 대신
  // 명시적 에러 메시지를 노출한다 — null(정상 미발급)과 undefined(에러)를 구분 (#247)
  const { data: cert, isError } = useDomainTls(domain.host);

  /** 타임스탬프(초) → 한국어 날짜 문자열 */
  const toKoDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('ko-KR');

  return (
    // mobile-first: 375px 단일 열 → md(768px) 이상 2열 (#90)
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          {/* updated_at=0은 미수정 상태 — epoch(1970) 대신 '—' 표시 */}
          <InfoRow label="수정일">{domain.updated_at ? toKoDate(domain.updated_at) : '—'}</InfoRow>
        </CardContent>
      </Card>

      {/* 오른쪽: TLS 상태 — Proxy/DNS 동기화 필드는 백엔드 미지원으로 제거(#72) */}
      <Card>
        <CardHeader>
          <CardTitle>TLS 상태</CardTitle>
        </CardHeader>
        <CardContent>
          {/* API 호출 실패 시 — '미발급' 거짓 표시 대신 명시적 에러 메시지 노출 (#247, #154 패턴) */}
          {isError ? (
            <p className="text-sm text-destructive" data-testid="domain-tls-info-error">
              인증서 정보를 불러올 수 없습니다
            </p>
          ) : (
            <>
              {/* TlsStatusBadge로 통일 — raw ● + text-* span 제거 (#73) */}
              <InfoRow label="TLS 상태">
                <TlsStatusBadge expiresAt={cert?.expires_at} />
              </InfoRow>
              <InfoRow label="TLS 만료일">
                {cert ? new Date(cert.expires_at).toLocaleDateString('ko-KR') : '—'}
              </InfoRow>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
