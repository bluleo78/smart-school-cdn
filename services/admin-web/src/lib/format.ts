/**
 * 숫자를 ko-KR 천단위 구분자(쉼표) 포맷으로 변환한다
 * - 인자 없는 toLocaleString()은 navigator.language에 따라 구분자가 달라짐
 *   (de-DE → "10.000", 일부 → NBSP "10 000") — 한국 사용자에게 오해 소지
 * - 앱 전체 ko-KR 정책 통일을 위해 본 헬퍼를 사용해야 한다 (#306)
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR');
}

/// 바이트를 사람이 읽기 좋은 단위로 변환한다
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 초 단위 업타임을 "N일 N시간 N분" 형식으로 변환
 * - 부팅 직후 0~59초는 "N초"로 표시해 카운트가 멈춰 보이지 않도록 한다
 * - NaN/Infinity/음수 등 비정상 입력은 placeholder("—") 반환 (시계 점프·데이터 누락 방어)
 */
export function formatUptime(seconds: number): string {
  // 비정상 입력 방어: 호출부 일관 정책(SystemPage 등)에서 사용하는 "—" placeholder 반환
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  // 60초 미만 구간은 초 단위로 표시 — 부팅 직후에도 변동이 보이도록
  if (seconds < 60) return `${Math.floor(seconds)}초`;
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

/**
 * 날짜 문자열·타임스탬프를 ko-KR 24시간제 시간 포맷(HH시 MM분 SS초)으로 변환한다
 * - LogViewer.formatTime과 동일 시그니처(toLocaleTimeString('ko-KR', { hour12: false }))로 통일 (#223)
 * - 인자 없는 toLocaleTimeString() 호출 시 브라우저 기본 로케일/12시간제로 폴백되는 문제 방지
 */
export function formatTime(value: string | number): string {
  return new Date(value).toLocaleTimeString('ko-KR', { hour12: false });
}
