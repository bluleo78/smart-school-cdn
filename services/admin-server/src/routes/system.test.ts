/// /api/system/status 라우트 유닛 테스트
/// 라우트는 HealthMonitor 캐시(getSystemStatus)를 그대로 반환한다.
/// 실제 downstream 호출(proxy HTTP / gRPC)은 HealthMonitor 단위 테스트에서 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { systemRoutes } from './system.js';
import type { HealthMonitor, SystemStatus } from '../health-monitor.js';

/** 테스트용 mock HealthMonitor — getSystemStatus가 주어진 status를 반환 */
function makeMockHealthMonitor(status: SystemStatus): HealthMonitor {
  return {
    getSystemStatus: () => status,
    getProxyStatus: () => ({ online: false, uptime: 0, request_count: 0 }),
  } as unknown as HealthMonitor;
}

/** 테스트용 Fastify 앱 생성 — HealthMonitor 데코레이터 주입 */
async function createApp(status: SystemStatus) {
  const app = Fastify({ logger: false });
  app.decorate('healthMonitor', makeMockHealthMonitor(status));
  await app.register(systemRoutes);
  return app;
}

/** 기본(모두 온라인) 상태 팩토리 */
function allOnlineStatus(): SystemStatus {
  return {
    proxy:     { online: true, latency_ms: 1 },
    storage:   { online: true, latency_ms: 3 },
    tls:       { online: true, latency_ms: 5 },
    dns:       { online: true, latency_ms: 2 },
    optimizer: { online: true, latency_ms: 4 },
  };
}

describe('GET /api/system/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('모든 서비스가 온라인일 때 online: true와 latency_ms >= 0을 반환한다', async () => {
    const app = await createApp(allOnlineStatus());
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
    const status = allOnlineStatus();
    status.proxy = { online: false, latency_ms: -1 };
    const app = await createApp(status);
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.online).toBe(false);
    expect(body.proxy.latency_ms).toBe(-1);
    // 나머지 서비스는 정상
    expect(body.storage.online).toBe(true);
  });

  it('storage-service gRPC 실패 시 storage.online이 false를 반환한다', async () => {
    const status = allOnlineStatus();
    status.storage = { online: false, latency_ms: -1 };
    const app = await createApp(status);
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.storage.online).toBe(false);
    expect(body.storage.latency_ms).toBe(-1);
    expect(body.proxy.online).toBe(true);
  });

  it('proxy HTTP가 non-ok 응답 시 proxy.online이 false를 반환한다', async () => {
    // HealthMonitor가 non-ok 응답을 offline으로 기록한 상황
    const status = allOnlineStatus();
    status.proxy = { online: false, latency_ms: -1 };
    const app = await createApp(status);
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proxy.online).toBe(false);
  });

  it('응답에 proxy/storage/tls/dns 4개 키가 모두 포함된다', async () => {
    const app = await createApp(allOnlineStatus());
    const res = await app.inject({ method: 'GET', url: '/api/system/status' });

    const body = res.json();
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['proxy', 'storage', 'tls', 'dns']));
    for (const key of ['proxy', 'storage', 'tls', 'dns']) {
      expect(typeof body[key].online).toBe('boolean');
      expect(typeof body[key].latency_ms).toBe('number');
    }
  });
});
