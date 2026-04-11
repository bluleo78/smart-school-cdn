/// 프록시 라우트 유닛 테스트
/// axios를 모킹하여 Proxy 관리 API 호출 결과에 따른 응답을 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { proxyRoutes } from './proxy.js';
import type { DomainRepository } from '../db/domain-repo.js';

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

/** 테스트용 Fastify 앱 생성 */
async function createApp(domainRepo?: DomainRepository) {
  const app = Fastify();
  await app.register(proxyRoutes, { domainRepo });
  return app;
}

describe('프록시 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/proxy/status ────────────────────────

  it('프록시 온라인 시 상태 정보를 반환한다', async () => {
    // Proxy 관리 API가 정상 응답하는 상황
    const statusData = { online: true, uptime: 120, request_count: 5 };
    mockAxiosGet.mockResolvedValueOnce({ data: statusData });

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/proxy/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(statusData);
    // axios가 올바른 URL로 호출되었는지 확인
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'http://localhost:8081/status',
      { timeout: 3000 },
    );
  });

  it('프록시 연결 실패 시 오프라인 상태를 반환한다', async () => {
    // Proxy 관리 API 연결 실패 상황 (서버 내려감)
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/proxy/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ online: false, uptime: 0, request_count: 0 });
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

    const app = await createApp(makeMockDomainRepo());
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

    const app = await createApp(makeMockDomainRepo());
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
    const app = await createApp(makeMockDomainRepo());
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
    const app = await createApp(makeMockDomainRepo());
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
    const app = await createApp(makeMockDomainRepo());
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
