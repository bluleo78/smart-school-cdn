/// TLS 테스트 데이터 팩토리
export function createCertList() {
  const now = new Date();
  const future30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const future3  = new Date(now.getTime() +  3 * 24 * 60 * 60 * 1000).toISOString();
  const past     = new Date(now.getTime() -  1 * 24 * 60 * 60 * 1000).toISOString();
  return [
    { domain: 'textbook.co.kr', issued_at: now.toISOString(), expires_at: future30 },
    { domain: 'cdn.edunet.net', issued_at: now.toISOString(), expires_at: future3  },
    { domain: 'expired.test',   issued_at: now.toISOString(), expires_at: past     },
  ];
}
