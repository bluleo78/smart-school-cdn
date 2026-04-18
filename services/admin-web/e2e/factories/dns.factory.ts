/// DNS 테스트 데이터 팩토리
/// DnsPage E2E에서 사용할 status/records/queries/metrics 더미 데이터를 생성한다.
/// admin-server 없이 프론트엔드만 독립 검증할 수 있도록 필드 구조는 실제 API와 일치시킨다.

/** DNS 상태 + 집계 (온라인 기본) */
export function createDnsStatusOnline(overrides?: Partial<{
  uptime_secs: number;
  total: number;
  matched: number;
  nxdomain: number;
  forwarded: number;
  top_domains: Array<{ qname: string; count: number }>;
}>) {
  return {
    online: true,
    uptime_secs: overrides?.uptime_secs ?? 3600,
    total: overrides?.total ?? 100,
    matched: overrides?.matched ?? 60,
    nxdomain: overrides?.nxdomain ?? 10,
    forwarded: overrides?.forwarded ?? 30,
    top_domains: overrides?.top_domains ?? [],
  };
}

/** DNS 상태 — 오프라인 (장애 배너 검증용) */
export function createDnsStatusOffline() {
  return {
    online: false,
    uptime_secs: 0,
    total: 0,
    matched: 0,
    nxdomain: 0,
    forwarded: 0,
    top_domains: [] as Array<{ qname: string; count: number }>,
  };
}

/** DNS 레코드 목록 응답 래퍼 (빈 목록 기본) */
export function createDnsRecords(
  entries: Array<{ host: string; target: string; rtype: string; source: string }> = [],
) {
  return { records: entries };
}

/** 최근 쿼리 3건 — matched/forwarded/nxdomain 각 1건씩 (결과 필터 토글 검증용) */
export function createDnsQueriesMixed() {
  const now = Date.now();
  return {
    entries: [
      {
        ts_unix_ms: now,
        client_ip: '10.0.0.10',
        qname: 'a.test',
        qtype: 'A',
        result: 'matched' as const,
        latency_us: 100,
      },
      {
        ts_unix_ms: now,
        client_ip: '10.0.0.11',
        qname: 'b.test',
        qtype: 'A',
        result: 'forwarded' as const,
        latency_us: 200,
      },
      {
        ts_unix_ms: now,
        client_ip: '10.0.0.12',
        qname: 'c.test',
        qtype: 'A',
        result: 'nxdomain' as const,
        latency_us: 300,
      },
    ],
  };
}

/** 메트릭 버킷 응답 래퍼 (빈 목록 기본) */
export function createDnsMetrics(
  buckets: Array<{ ts: number; total: number; matched: number; nxdomain: number; forwarded: number }> = [],
) {
  return { buckets };
}
