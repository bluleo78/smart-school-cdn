/// 바이트를 사람이 읽기 좋은 단위로 변환한다
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 초 단위 업타임을 "N일 N시간 N분" 형식으로 변환 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  parts.push(`${minutes}분`);
  return parts.join(' ');
}

/** 날짜 문자열·타임스탬프를 ko-KR 날짜 포맷(YYYY. M. D.)으로 변환한다 */
export function formatDate(value: string | number): string {
  return new Date(value).toLocaleDateString('ko-KR');
}

/** 날짜 문자열·타임스탬프를 ko-KR 24시간제 날짜+시간 포맷(YYYY. M. D. HH:MM:SS)으로 변환한다 */
export function formatDateTime(value: string | number): string {
  // hour12: false — 앱 전체 24시간제 표기 정책(로그 뷰어, 도메인 로그, 대시보드)과 통일
  return new Date(value).toLocaleString('ko-KR', { hour12: false });
}
