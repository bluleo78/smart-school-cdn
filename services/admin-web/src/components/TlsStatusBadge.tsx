/** TLS 상태 배지 — 앱 전체 공용
 * SystemPage 인증서 목록, DomainInfoCards, DomainSettingsTab 세 곳에서
 * 동일한 TLS 상태를 Badge 컴포넌트로 통일하기 위해 추출한 공용 컴포넌트.
 *
 * 상태 판별 기준:
 *   - null / undefined → 미발급 (muted)
 *   - 만료일 ≤ 오늘   → 만료됨 (destructive)
 *   - 만료일 ≤ 30일   → 만료 N일 전 (warning)
 *   - 그 외           → 유효 (success)
 */
import { Badge } from './ui/badge';

interface Props {
  /** ISO 8601 형식의 만료일 문자열. null/undefined 이면 '미발급'으로 표시한다. */
  expiresAt: string | null | undefined;
}

/** 만료일 문자열을 받아 TLS 상태에 맞는 Badge를 반환한다 */
export function TlsStatusBadge({ expiresAt }: Props) {
  // 인증서 미발급 상태
  if (!expiresAt) {
    return <Badge variant="outline">미발급</Badge>;
  }

  const expiresMs = new Date(expiresAt).getTime();
  // eslint-disable-next-line react-hooks/purity -- 만료일 계산에 현재 시간 필요
  const daysUntilExpiry = Math.floor((expiresMs - Date.now()) / 86_400_000);

  // 만료됨
  if (daysUntilExpiry <= 0) {
    return <Badge variant="destructive">만료됨</Badge>;
  }

  // 30일 이내 만료 임박
  if (daysUntilExpiry <= 30) {
    return <Badge variant="warning">만료 {daysUntilExpiry}일 전</Badge>;
  }

  // 정상 유효
  return <Badge variant="success">유효</Badge>;
}
