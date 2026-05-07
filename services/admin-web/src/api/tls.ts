/// TLS API 클라이언트 — Admin Server의 TLS 엔드포인트를 호출한다.

/** 발급된 인증서 정보 */
export interface CertInfo {
  domain: string;
  issued_at: string;   // ISO 8601
  expires_at: string;  // ISO 8601
}

/** 브라우저 파일 다운로드 트리거 헬퍼
 *
 * 이전 구현은 `<a href download>` click만 호출해 응답 상태 확인이 불가능했고,
 * 4xx/5xx 응답 시 빈 파일이 받아지거나 silent 실패해 사용자 피드백이 전혀 없었다(#187).
 * fetch로 응답 상태를 먼저 확인한 뒤 Blob → ObjectURL anchor click으로 다운로드를 트리거하고,
 * 실패 시 throw 해 호출처에서 toast.error 등으로 처리할 수 있게 한다.
 */
async function triggerDownload(href: string, filename: string): Promise<void> {
  const res = await fetch(href);
  if (!res.ok) {
    throw new Error(`다운로드 실패: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // ObjectURL 누수 방지 — 동기 click 직후 즉시 revoke 가능
    URL.revokeObjectURL(url);
  }
}

/** CA 인증서 파일 다운로드 (.crt) — 실패 시 throw */
export async function downloadCACert(): Promise<void> {
  await triggerDownload('/api/tls/ca', 'smart-school-cdn-ca.crt');
}

/** iOS 구성 프로파일 다운로드 (.mobileconfig) — 실패 시 throw */
export async function downloadMobileConfig(): Promise<void> {
  await triggerDownload('/api/tls/ca/mobileconfig', 'smart-school-cdn.mobileconfig');
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
