/** TLS 상태 배지 — 앱 전체 공용
 * SystemPage 인증서 목록, DomainInfoCards, DomainSettingsTab 세 곳에서
 * 동일한 TLS 상태를 Badge 컴포넌트로 통일하기 위해 추출한 공용 컴포넌트.
 *
 * 상태 판별 기준 (현재 시각 기준 정확한 시각 비교):
 *   - null / undefined  → 미발급 (muted)
 *   - 만료시각 ≤ 현재   → 만료됨 (destructive)
 *   - 24시간 이내 만료  → N시간 후 만료 (destructive) — 0~24h 미래 만료를
 *                          '만료됨'과 명확히 구분하기 위해 시간 단위 표시 (#196)
 *   - 30일 이내 만료    → N일 후 만료 (warning)
 *   - 그 외             → 유효 (success)
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
  const diffMs = expiresMs - Date.now();

  // 이미 만료됨 (또는 정확히 만료 시각)
  if (diffMs <= 0) {
    return <Badge variant="destructive">만료됨</Badge>;
  }

  // 24시간 이내 미래 만료 — 이전 구현은 Math.floor로 0이 되어 '만료됨'으로 잘못 표시됐다.
  // 시간 단위로 표현해 '이미 만료'와 '오늘 안에 만료 예정'을 시각적으로 구분한다 (#196).
  const HOUR_MS = 3_600_000;
  const DAY_MS = 86_400_000;
  if (diffMs < DAY_MS) {
    // Math.max(1, ...) — 0시간이 출력되지 않도록 최소 1시간으로 표시.
    // (1시간 미만이라도 '아직 유효'한 상태는 '곧 만료'로 알린다.)
    const hours = Math.max(1, Math.floor(diffMs / HOUR_MS));
    return <Badge variant="destructive">{hours}시간 후 만료</Badge>;
  }

  // 30일 이내 만료 임박 — 24시간 이상 남았으므로 일 단위 표시.
  // Math.ceil로 25h 미래 만료가 '1일 후 만료'로 표시되도록 한다.
  const days = Math.ceil(diffMs / DAY_MS);
  if (days <= 30) {
    // "만료 N일 전"은 한국어에서 '이미 N일 전에 만료'로 오독될 수 있어
    // "N일 후 만료"로 표현해 '아직 유효, N일 뒤에 만료될 예정'임을 명확히 한다.
    return <Badge variant="warning">{days}일 후 만료</Badge>;
  }

  // 정상 유효
  return <Badge variant="success">유효</Badge>;
}
