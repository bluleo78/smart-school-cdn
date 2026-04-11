/// 프록시 테스트 데이터 팩토리
/// E2E 테스트에서 사용할 프록시 상태 및 요청 로그 더미 데이터를 생성한다.

/** 프록시 온라인 상태 데이터 생성 */
export function createProxyStatusOnline(overrides?: Partial<{
  uptime: number;
  request_count: number;
}>) {
  return {
    online: true,
    uptime: overrides?.uptime ?? 3600,
    request_count: overrides?.request_count ?? 42,
  };
}

/** 프록시 오프라인 상태 데이터 생성 */
export function createProxyStatusOffline() {
  return {
    online: false,
    uptime: 0,
    request_count: 0,
  };
}

/** 요청 로그 목록 데이터 생성 (3건) */
export function createRequestLogs() {
  return [
    {
      method: 'GET',
      host: 'httpbin.org',
      url: '/get',
      status_code: 200,
      response_time_ms: 150,
      timestamp: '2026-04-11T12:00:00Z',
    },
    {
      method: 'POST',
      host: 'api.test.com',
      url: '/data',
      status_code: 201,
      response_time_ms: 80,
      timestamp: '2026-04-11T12:00:01Z',
    },
    {
      method: 'GET',
      host: 'cdn.test.com',
      url: '/img.png',
      status_code: 404,
      response_time_ms: 30,
      timestamp: '2026-04-11T12:00:02Z',
    },
  ];
}
