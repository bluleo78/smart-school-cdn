/// TLS API 클라이언트 — Admin Server의 TLS 엔드포인트를 호출한다.

/** 발급된 인증서 정보 */
export interface CertInfo {
  domain: string;
  issued_at: string;   // ISO 8601
  expires_at: string;  // ISO 8601
}

/** CA 인증서 파일 다운로드 (.crt) — 브라우저 파일 다운로드 트리거 */
export function downloadCACert(): void {
  const a = document.createElement('a');
  a.href = '/api/tls/ca';
  a.download = 'smart-school-cdn-ca.crt';
  a.click();
}

/** iOS 구성 프로파일 다운로드 (.mobileconfig) */
export function downloadMobileConfig(): void {
  const a = document.createElement('a');
  a.href = '/api/tls/ca/mobileconfig';
  a.download = 'smart-school-cdn.mobileconfig';
  a.click();
}

/** 발급된 도메인 인증서 목록 조회 */
export async function fetchCertificates(): Promise<CertInfo[]> {
  const res = await fetch('/api/tls/certificates');
  if (!res.ok) throw new Error('인증서 목록 조회 실패');
  return res.json() as Promise<CertInfo[]>;
}
