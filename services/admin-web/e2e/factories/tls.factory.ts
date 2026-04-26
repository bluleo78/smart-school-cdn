/// TLS 테스트 데이터 팩토리
/// TlsStatusBadge 기준: >30일 → 유효, 1~30일 → 만료 N일 전, ≤0 → 만료됨
export function createCertList() {
  const now = new Date();
  // 60일 후 만료 → '유효' 배지 (>30일 조건 충족)
  const future60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
  // 3일 후 만료 → '만료 3일 전' 배지 (1~30일 조건 충족)
  const future3  = new Date(now.getTime() +  3 * 24 * 60 * 60 * 1000).toISOString();
  // 어제 만료 → '만료됨' 배지 (≤0 조건 충족)
  const past     = new Date(now.getTime() -  1 * 24 * 60 * 60 * 1000).toISOString();
  return [
    { domain: 'textbook.co.kr', issued_at: now.toISOString(), expires_at: future60 },
    { domain: 'cdn.edunet.net', issued_at: now.toISOString(), expires_at: future3  },
    { domain: 'expired.test',   issued_at: now.toISOString(), expires_at: past     },
  ];
}
