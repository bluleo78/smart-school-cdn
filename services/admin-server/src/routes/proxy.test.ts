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
    mockAxiosGet.mockResolvedValueOnce({ status: 200 });

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
  });

  it('프록시 서버 연결 실패 시 success: false와 error를 반환한다', async () => {
    // 프록시 서버 자체에 연결할 수 없는 상황
    mockAxiosGet.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8080'));

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
    expect(body.error).toContain('ECONNREFUSED');
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
    expect(res.json().error).toContain('등록되지 않은 도메인');
    expect(mockAxiosGet).not.toHaveBeenCalled();
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
    expect(res.json().error).toContain('유효하지 않은 경로');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });
});
