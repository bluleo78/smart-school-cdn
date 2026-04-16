/// TLS API 클라이언트 — Admin Server의 TLS 엔드포인트를 호출한다.

/** 발급된 인증서 정보 */
export interface CertInfo {
  domain: string;
  issued_at: string;   // ISO 8601
  expires_at: string;  // ISO 8601
}

/** 브라우저 파일 다운로드 트리거 헬퍼 */
function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** CA 인증서 파일 다운로드 (.crt) */
export function downloadCACert(): void {
  triggerDownload('/api/tls/ca', 'smart-school-cdn-ca.crt');
}

/** iOS 구성 프로파일 다운로드 (.mobileconfig) */
export function downloadMobileConfig(): void {
  triggerDownload('/api/tls/ca/mobileconfig', 'smart-school-cdn.mobileconfig');
}

/** 발급된 도메인 인증서 목록 조회 */
export async function fetchCertificates(): Promise<CertInfo[]> {
  const res = await fetch('/api/tls/certificates');
  if (!res.ok) throw new Error('인증서 목록 조회 실패');
  return res.json() as Promise<CertInfo[]>;
}

/** TLS 인증서 갱신 요청 */
export async function renewCert(host: string): Promise<{ success: boolean; host: string }> {
  const res = await fetch(`/api/tls/renew/${encodeURIComponent(host)}`, { method: 'POST' });
  if (!res.ok) throw new Error('TLS 갱신 실패');
  return res.json() as Promise<{ success: boolean; host: string }>;
}

/** 도메인 강제 동기화 */
export async function syncDomain(host: string): Promise<{ proxy: boolean; tls: boolean; dns: boolean }> {
  const res = await fetch(`/api/domains/${encodeURIComponent(host)}/sync`, { method: 'POST' });
  if (!res.ok) throw new Error('동기화 실패');
  return res.json() as Promise<{ proxy: boolean; tls: boolean; dns: boolean }>;
}
