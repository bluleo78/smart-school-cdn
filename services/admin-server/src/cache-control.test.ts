/**
 * Cache-Control 헤더 검증 테스트 (#316)
 *
 * admin-server의 모든 `/api/*` 응답은 인증 세션·도메인 목록·로그 등 민감 데이터를
 * 포함할 수 있으므로 브라우저 bfcache·service worker·내부망 중간 프록시 캐시를
 * 모두 차단해야 한다. 전역 onSend 훅이 헤더를 부착하는지를 확인한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

/**
 * 테스트용 Fastify 앱 빌드 — index.ts 의 onSend 훅 로직을 동일하게 반영한다.
 * 실제 라우트 의존성(DB·gRPC·인증)을 끌어오지 않고 훅 동작만 격리 검증.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store, max-age=0');
      reply.header('Pragma', 'no-cache');
    }
    return payload;
  });
  app.get('/api/auth/state', async () => ({ user: 'admin' }));
  app.get('/api/domains', async () => ([{ host: 'example.com' }]));
  app.get('/healthz', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('Cache-Control 헤더 (#316)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/auth/state 응답에 Cache-Control: no-store 가 부착된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('/api/domains 응답에도 동일하게 부착된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store, max-age=0');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('/api/* 가 아닌 경로는 영향받지 않는다 (예: /healthz)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    // 훅이 적용되지 않으므로 Cache-Control 헤더가 없어야 한다.
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['pragma']).toBeUndefined();
  });
});
