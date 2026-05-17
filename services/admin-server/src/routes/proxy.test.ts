/// 프록시 라우트 유닛 테스트
/// GET /api/proxy/status — HealthMonitor 캐시 반환 (axios 호출 없음)
/// GET /api/proxy/requests, POST /api/proxy/test — axios 호출을 모킹하여 검증
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { proxyRoutes } from './proxy.js';
import type { DomainRepository } from '../db/domain-repo.js';
import type { HealthMonitor, ProxyStatus } from '../health-monitor.js';

// axios 모듈 전체를 모킹 — Proxy 관리 API 호출을 시뮬레이션
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import axios from 'axios';
const mockAxiosGet = vi.mocked(axios.get);

/** 테스트용 mock DomainRepository — httpbin.org만 허용 */
function makeMockDomainRepo(allowedHost = 'httpbin.org'): DomainRepository {
  return {
    findByHost: vi.fn((host: string) =>
      host === allowedHost
        ? { host, origin: `https://${host}`, created_at: 0 }
        : undefined,
    ),
    upsert: vi.fn(),
    findAll: vi.fn(() => []),
    delete: vi.fn(() => 0),
  } as unknown as DomainRepository;
}

/** 테스트용 mock HealthMonitor — getProxyStatus만 구현 (라우트가 쓰는 API만) */
function makeMockHealthMonitor(status: ProxyStatus): HealthMonitor {
  return {
    getProxyStatus: () => status,
    getSystemStatus: () => ({ /* unused in proxy tests */ }),
  } as unknown as HealthMonitor;
}

/** 테스트용 Fastify 앱 생성 — HealthMonitor 데코레이터 주입 */
async function createApp(options: {
  domainRepo?: DomainRepository;
  proxyStatus?: ProxyStatus;
} = {}) {
  const app = Fastify();
  const proxyStatus = options.proxyStatus ?? { online: false, uptime: 0, request_count: 0 };
  app.decorate('healthMonitor', makeMockHealthMonitor(proxyStatus));
  await app.register(proxyRoutes, { domainRepo: options.domainRepo });
  return app;
}

describe('프록시 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/proxy/status ────────────────────────

  it('프록시 온라인 시 상태 정보를 반환한다', async () => {
    // HealthMonitor 캐시에 온라인 상태가 기록된 상황
    const statusData: ProxyStatus = { online: true, uptime: 120, request_count: 5 };

    const app = await createApp({ proxyStatus: statusData });
    const res = await app.inject({ method: 'GET', url: '/api/proxy/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(statusData);
    // 라우트는 더 이상 downstream axios를 호출하지 않음 (HealthMonitor 캐시 반환)
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('프록시 연결 실패 시 오프라인 상태를 반환한다', async () => {
    // HealthMonitor 캐시에 오프라인 상태가 기록된 상황
    const offlineStatus: ProxyStatus = { online: false, uptime: 0, request_count: 0 };

    const app = await createApp({ proxyStatus: offlineStatus });
    const res = await app.inject({ method: 'GET', url: '/api/proxy/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(offlineStatus);
  });

  // ─── GET /api/proxy/requests ──────────────────────

  it('요청 로그를 정상 반환한다', async () => {
    // Proxy 관리 API가 로그 배열을 반환하는 상황
    const logsData = [
      {
        method: 'GET',
        host: 'httpbin.org',
        url: '/get',
        status_code: 200,
        response_time_ms: 150,
        timestamp: '2026-04-11T12:00:00Z',
      },
    ];
    mockAxiosGet.mockResolvedValueOnce({ data: logsData });

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/proxy/requests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(logsData);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'http://localhost:8081/requests',
      { timeout: 3000 },
    );
  });

  it('요청 로그 조회 실패 시 빈 배열을 반환한다', async () => {
    // Proxy 관리 API 연결 실패 상황
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/proxy/requests' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // ─── POST /api/proxy/test ─────────────────────────

  it('프록시 테스트 성공 시 status_code와 response_time_ms를 반환한다', async () => {
    // 프록시 서버가 200 응답을 돌려주는 상황
    mockAxiosGet.mockResolvedValueOnce({ status: 200, headers: {} });

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.status_code).toBe(200);
    expect(typeof body.response_time_ms).toBe('number');
    // 헤더가 없는 경우 빈 객체를 반환해야 한다
    expect(body.response_headers).toEqual({});
  });

  it('프록시 테스트 성공 시 CDN 관련 헤더를 response_headers로 반환한다', async () => {
    // 프록시가 X-Cache, Content-Type 등 CDN 관련 헤더를 포함하여 응답하는 상황
    mockAxiosGet.mockResolvedValueOnce({
      status: 200,
      headers: {
        'x-cache': 'HIT',
        'x-cache-status': 'HIT',
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'max-age=3600',
        'etag': '"abc123"',
        'server': 'nginx',       // RELEVANT_HEADERS에 없으므로 제외되어야 한다
        'x-custom': 'ignored',   // RELEVANT_HEADERS에 없으므로 제외되어야 한다
      },
    });

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // CDN 관련 주요 5개 헤더가 모두 반환되어야 한다
    expect(body.response_headers).toEqual({
      'x-cache': 'HIT',
      'x-cache-status': 'HIT',
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'max-age=3600',
      'etag': '"abc123"',
    });
    // 관련 없는 헤더(server, x-custom)는 제외되어야 한다
    expect(body.response_headers).not.toHaveProperty('server');
    expect(body.response_headers).not.toHaveProperty('x-custom');
  });

  it('프록시 서버 연결 실패 시 sanitize된 한국어 메시지와 error_code를 반환한다 (#166)', async () => {
    // 프록시 서버 자체에 연결할 수 없는 상황 — axios는 err.code='ECONNREFUSED'를 부여한다
    const econnRefused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8080'), {
      code: 'ECONNREFUSED',
    });
    mockAxiosGet.mockRejectedValueOnce(econnRefused);

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.status_code).toBe(0);
    // 머신 코드는 화이트리스트의 connection_refused여야 한다
    expect(body.error_code).toBe('connection_refused');
    // 사용자 표시 메시지는 한국어 한 문장 — raw 'ECONNREFUSED' 토큰이 새어나가지 않아야 한다
    expect(body.error).toBe('프록시 서버에 연결할 수 없습니다.');
    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).not.toContain('127.0.0.1');
  });

  // 회귀 테스트 (#166) — axios가 OpenSSL EPROTO를 throw하면 err.message에 OpenSSL 내부
  // 빌드 경로(`../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918`), 라이브러리 심볼,
  // SSL alert 번호가 포함된다. 이를 그대로 응답으로 흘리면 사용자 화면에 영문 stack-like
  // 메시지가 노출되고 내부 의존성 단서가 새어나간다. classify로 tls_handshake_failed 카테고리로
  // 환원되고, 사용자 표시 메시지는 한국어 한 문장이어야 한다.
  it('TLS 핸드셰이크 실패(OpenSSL EPROTO) 시 raw 메시지를 노출하지 않고 카테고리화한다 (#166)', async () => {
    const tlsAlert = Object.assign(
      new Error(
        'write EPROTO C0182AEE01000000:error:0A000419:SSL routines:ssl3_read_bytes:tlsv1 alert access denied:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918:SSL alert number 49\n',
      ),
      { code: 'EPROTO' },
    );
    mockAxiosGet.mockRejectedValueOnce(tlsAlert);

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get', protocol: 'https' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error_code).toBe('tls_handshake_failed');
    expect(body.error).toBe('TLS 핸드셰이크에 실패했습니다.');
    // raw 토큰들이 응답 어디에도 포함되지 않아야 한다 (정보 노출 회귀 방지)
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('OpenSSL');
    expect(serialized).not.toContain('openssl');
    expect(serialized).not.toContain('rec_layer_s3');
    expect(serialized).not.toContain('SSL alert');
    expect(serialized).not.toContain('EPROTO');
    expect(serialized).not.toMatch(/0x?[0-9A-F]{16,}/i);
  });

  it('타임아웃(ETIMEDOUT) 시 timeout 카테고리와 한국어 메시지를 반환한다 (#166)', async () => {
    const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    mockAxiosGet.mockRejectedValueOnce(timeout);

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error_code).toBe('timeout');
    expect(body.error).toBe('요청 시간이 초과되었습니다.');
    expect(body.error).not.toContain('10000ms');
  });

  it('분류되지 않은 에러는 unknown 카테고리로 일반화한다 (#166)', async () => {
    // 화이트리스트 외 — raw 메시지가 새어나가지 않아야 한다
    mockAxiosGet.mockRejectedValueOnce(new Error('Some weird internal failure with /private/path'));

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error_code).toBe('unknown');
    expect(body.error).toBe('프록시 요청에 실패했습니다.');
    expect(body.error).not.toContain('/private/path');
    expect(body.error).not.toContain('weird');
  });

  // 방어 심층화 (#166) — path가 '/'로 시작하지 않으면 backend에 도달하지 않고 400을 반환해
  // raw 에러 노출 경로 자체를 축소한다.
  it('path가 "/"로 시작하지 않으면 400 invalid_path를 반환한다 (#166)', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: 'abc', protocol: 'https' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_path');
    expect(res.json().message).toContain('"/"로 시작');
    // axios 호출이 발생하지 않아야 — raw TLS 에러 경로가 열리지 않음을 보증
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('domain 또는 path가 누락된 경우 400을 반환한다', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org' },
    });

    expect(res.statusCode).toBe(400);
    // 필드 누락 시 axios.get이 호출되지 않아야 한다
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('등록되지 않은 도메인은 400을 반환한다 (SSRF 방어)', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'evil.internal', path: '/secret' },
    });

    expect(res.statusCode).toBe(400);
    // 표준 envelope (#327): 머신 코드는 `error`, 사용자 표시 메시지는 `message`
    expect(res.json().error).toBe('domain_not_registered');
    expect(res.json().message).toContain('등록되지 않은 도메인');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('domain 입력이 대문자/공백을 포함해도 정규화하여 등록된 도메인과 매칭한다 (#296)', async () => {
    // DNS 호스트는 case-insensitive하고 사용자 입력에 공백이 섞일 수 있어
    // trim + lowercase 정규화로 등록된 도메인 매칭이 이루어져야 한다.
    mockAxiosGet.mockResolvedValueOnce({ status: 200, headers: {} });

    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: ' HTTPBIN.ORG ', path: '/get' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    // axios 요청 Host 헤더도 정규화된 값으로 전달되어야 한다 (origin 매칭 일관성).
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Host: 'httpbin.org' } }),
    );
  });

  it('path에 상대 경로(..) 또는 인코딩된 경로가 포함된 경우 400을 반환한다', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/%2e%2e/etc/passwd' },
    });

    expect(res.statusCode).toBe(400);
    // 표준 envelope (#327)
    expect(res.json().error).toBe('invalid_path');
    expect(res.json().message).toContain('유효하지 않은 경로');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  // 회귀 테스트 (#359) — 빈/null 바디는 destructure가 TypeError를 throw하여
  // 5xx envelope로 내부 변수명("Cannot destructure property 'domain' of 'request.body' as it is undefined")이
  // 노출되었다. `request.body ?? {}` 가드로 누락 필드 경로(400 invalid_input)로 합류해야 한다.
  it('빈 바디로 POST 시 500이 아닌 400 invalid_input을 반환한다 (#359)', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      // payload 미지정 — Fastify가 request.body를 undefined로 처리
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
    expect(res.json().message).toContain('domain과 path는 필수');
    // 내부 destructure 메시지가 새어나가지 않아야 함
    expect(res.json().message).not.toContain('destructure');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('null 바디로 POST 시 500이 아닌 400 invalid_input을 반환한다 (#359)', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: 'null',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
    expect(res.json().message).toContain('domain과 path는 필수');
    expect(res.json().message).not.toContain('destructure');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  // 회귀 테스트 (#360) — 잘못된 percent-encoding(%ZZ 등)은 decodeURIComponent가 URIError를 throw하는데,
  // try/catch 없으면 Fastify 기본 500 envelope ({statusCode, error: 'Internal Server Error', message: 'URI malformed'})로
  // raw 노출된다. 사용자 입력 오류이므로 400 invalid_path 표준 envelope로 변환되어야 한다.
  it('path에 잘못된 percent-encoding이 포함되면 500이 아닌 400 invalid_path를 반환한다 (#360)', async () => {
    const app = await createApp({ domainRepo: makeMockDomainRepo() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/test',
      headers: { 'content-type': 'application/json' },
      payload: { domain: 'httpbin.org', path: '/test%ZZ' },
    });

    expect(res.statusCode).toBe(400);
    // 표준 envelope (#327) — URI malformed가 raw로 새어나가지 않는지 보증
    expect(res.json().error).toBe('invalid_path');
    expect(res.json().message).toContain('유효하지 않은 경로');
    // 다른 잘못된 시퀀스도 동일하게 처리되는지 — Fastify 기본 envelope 키는 없어야 함
    expect(res.json().statusCode).toBeUndefined();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });
});
