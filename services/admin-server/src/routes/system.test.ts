/// /api/system/status 라우트 유닛 테스트
/// 각 서비스(proxy/storage/tls/dns) 헬스체크 응답을 모킹하여 집계 결과를 검증한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { systemRoutes } from './system.js';

/** gRPC 클라이언트 mock */
const mockStorageClient = { health: vi.fn() };
const mockTlsClient     = { health: vi.fn() };
const mockDnsClient     = { health: vi.fn() };

/** 테스트용 Fastify 앱 생성 — 모든 서비스 데코레이터 주입 */
async function createApp(proxyAdminUrl = 'http://proxy:8081') {
  const app = Fastify({ logger: false });
  app.decorate('storageClient', mockStorageClient);
  app.decorate('tlsClient',     mockTlsClient);
  app.decorate('dnsClient',     mockDnsClient);
  app.decorate('proxyAdminUrl', proxyAdminUrl);
  await app.register(systemRoutes);
  return app;
}

describe('GET /api/system/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fetch 전역 mock 초기화 — proxy HTTP 헬스체크용
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('모든 서비스가 온라인일 때 online: true와 latency_ms >= 0을 반환한다', async () => {
    // 모든 gRPC 서비스 정상 응답
    mockStorageClient.health.mockResolvedValueOnce({ online: true, latency_ms: 3 });
    mockTlsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 5 });
    mockDnsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 2 });
    // proxy HTTP 정상 응답
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.online).toBe(true);
    expect(body.storage.online).toBe(true);
    expect(body.tls.online).toBe(true);
    expect(body.dns.online).toBe(true);
    expect(body.storage.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('proxy HTTP 실패 시 proxy.online이 false를 반환한다', async () => {
    mockStorageClient.health.mockResolvedValueOnce({ online: true, latency_ms: 3 });
    mockTlsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 5 });
    mockDnsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 2 });
    // proxy HTTP 연결 실패
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.online).toBe(false);
    expect(body.proxy.latency_ms).toBe(-1);
    // 나머지 서비스는 정상
    expect(body.storage.online).toBe(true);
  });

  it('storage-service gRPC 실패 시 storage.online이 false를 반환한다', async () => {
    mockStorageClient.health.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    mockTlsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 5 });
    mockDnsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 2 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.storage.online).toBe(false);
    expect(body.storage.latency_ms).toBe(-1);
    expect(body.proxy.online).toBe(true);
  });

  it('proxy HTTP가 non-ok 응답 시 proxy.online이 false를 반환한다', async () => {
    mockStorageClient.health.mockResolvedValueOnce({ online: true, latency_ms: 3 });
    mockTlsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 5 });
    mockDnsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 2 });
    // proxy HTTP 500 응답
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.online).toBe(false);
  });

  it('응답에 proxy/storage/tls/dns 4개 키가 모두 포함된다', async () => {
    mockStorageClient.health.mockResolvedValueOnce({ online: true, latency_ms: 3 });
    mockTlsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 5 });
    mockDnsClient.health.mockResolvedValueOnce({ online: true, latency_ms: 2 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    const body = res.json();
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['proxy', 'storage', 'tls', 'dns']));
    for (const key of ['proxy', 'storage', 'tls', 'dns']) {
      expect(typeof body[key].online).toBe('boolean');
      expect(typeof body[key].latency_ms).toBe('number');
    }
  });
});
