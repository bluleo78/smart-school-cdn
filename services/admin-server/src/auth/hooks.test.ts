import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { requireAuth } from './require-auth.js';
import { requireInternalToken } from './require-internal-token.js';
import { signSessionToken, SESSION_COOKIE_NAME } from './jwt.js';

async function buildApp(): Promise<FastifyInstance> {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  process.env.INTERNAL_API_TOKEN = 'a'.repeat(64);

  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireInternalToken);
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/protected', async () => ({ secret: 42 }));
  app.get('/internal/x', async () => ({ internal: true }));
  app.post('/api/auth/login', async () => ({ login: true }));
  return app;
}

describe('auth hooks', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });

  it('/api/health 는 인증 스킵', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
  });

  it('/api/auth/login 은 인증 스킵', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(r.statusCode).toBe(200);
  });

  it('/api/protected — 쿠키 없음 → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(r.statusCode).toBe(401);
  });

  it('/api/protected — 유효 쿠키 → 200', async () => {
    const token = signSessionToken({ sub: '1', username: 'a@b.c' });
    const r = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(r.statusCode).toBe(200);
  });

  it('/api/protected — 조작된 쿠키 → 401', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { [SESSION_COOKIE_NAME]: 'bad.token.here' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('/internal/x — X-Internal-Token 없음 → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/internal/x' });
    expect(r.statusCode).toBe(401);
  });

  it('/internal/x — 토큰 일치 → 200', async () => {
    const r = await app.inject({
      method: 'GET', url: '/internal/x',
      headers: { 'x-internal-token': 'a'.repeat(64) },
    });
    expect(r.statusCode).toBe(200);
  });

  it('/internal/x — 토큰 길이 다름 → 401 (timing-safe 비교 guard)', async () => {
    const r = await app.inject({
      method: 'GET', url: '/internal/x',
      headers: { 'x-internal-token': 'a'.repeat(32) },
    });
    expect(r.statusCode).toBe(401);
  });

  it('/internal/x — 토큰 불일치 → 401', async () => {
    const r = await app.inject({
      method: 'GET', url: '/internal/x',
      headers: { 'x-internal-token': 'b'.repeat(64) },
    });
    expect(r.statusCode).toBe(401);
  });
});
