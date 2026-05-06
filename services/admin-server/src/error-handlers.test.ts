// 에러 응답 envelope 통일 (#175) — registerErrorHandlers 단위 테스트
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandlers } from './error-handlers.js';

describe('registerErrorHandlers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    // 스키마 검증 실패 케이스용 라우트
    app.post(
      '/schema',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      async () => ({ ok: true }),
    );
    // 미잡힌 throw 케이스용 라우트 (5xx)
    app.get('/boom', async () => {
      throw new Error('boom!');
    });
    // 4xx 에러 케이스 — Fastify httpErrors 패턴은 statusCode 가 붙은 에러를 throw
    app.get('/forbidden', async () => {
      const err = new Error('access denied') as Error & { statusCode?: number; code?: string };
      err.statusCode = 403;
      err.code = 'forbidden';
      throw err;
    });
    registerErrorHandlers(app);
    await app.ready();
  });

  it('404 not-found — { error:"not_found", message:"Route ..." } envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toEqual({
      error: 'not_found',
      message: 'Route GET:/api/auth/me not found',
    });
  });

  it('schema 검증 실패 — { error:"invalid_input", issues:[...] }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/schema',
      payload: { extra: 1 }, // name 누락
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('invalid_input');
    expect(body.issues).toBeDefined();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('미잡힌 throw — 500 + { error:"internal_error" }', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('internal_error');
    expect(body.message).toBe('boom!');
  });

  it('4xx + err.code — code를 머신 코드로 사용', async () => {
    const res = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe('forbidden');
    expect(body.message).toBe('access denied');
  });
});
