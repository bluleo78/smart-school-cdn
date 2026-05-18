import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { createRequireAuth } from './require-auth.js';
import { requireInternalToken } from './require-internal-token.js';
import { signSessionToken, SESSION_COOKIE_NAME } from './jwt.js';
import { UserRepository, USER_SCHEMA, type UserRow } from '../db/user-repo.js';

async function buildApp(): Promise<{ app: FastifyInstance; repo: UserRepository; user: UserRow }> {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  process.env.INTERNAL_API_TOKEN = 'a'.repeat(64);

  const db = new Database(':memory:');
  db.exec(USER_SCHEMA);
  const repo = new UserRepository(db);
  const user = repo.create('a@b.c', 'h');

  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', createRequireAuth(repo));
  app.addHook('preHandler', requireInternalToken);
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/protected', async () => ({ secret: 42 }));
  app.get('/internal/x', async () => ({ internal: true }));
  app.post('/api/auth/login', async () => ({ login: true }));
  app.post('/api/auth/logout', async () => ({ logout: true }));
  app.get('/api/auth/state', async () => ({ state: 'authenticated' }));
  app.post('/api/auth/setup', async () => ({ setup: true }));
  return { app, repo, user };
}

describe('auth hooks', () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let user: UserRow;
  beforeEach(async () => {
    ({ app, repo, user } = await buildApp());
  });

  it('/api/health 는 인증 스킵', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
  });

  it('/api/auth/login 은 인증 스킵', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(r.statusCode).toBe(200);
  });

  it('/api/auth/state 는 인증 스킵', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(r.statusCode).toBe(200);
  });

  it('/api/auth/setup 은 인증 스킵', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup' });
    expect(r.statusCode).toBe(200);
  });

  // 이슈 #328 — logout 은 인증 필수. 미인증 호출은 401 로 거부되어 CSRF·로그 위조 방지.
  it('/api/auth/logout — 쿠키 없으면 401 (#328)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(r.statusCode).toBe(401);
  });

  it('/api/auth/logout — 유효 쿠키면 200 (#328)', async () => {
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
    const r = await app.inject({
      method: 'POST', url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(r.statusCode).toBe(200);
  });

  it('/api/protected — 쿠키 없음 → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/protected' });
    expect(r.statusCode).toBe(401);
  });

  it('/api/protected — 유효 쿠키 → 200', async () => {
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
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

  // 이슈 #330 — 비활성화된 사용자의 기존 JWT 세션은 즉시 차단되어야 한다.
  it('/api/protected — 사용자가 비활성화되면 기존 토큰 401 + 쿠키 삭제', async () => {
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
    repo.disable(user.id);
    const r = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(r.statusCode).toBe(401);
    // 쿠키 무효화 헤더 — Max-Age=0 (또는 expires past) 확인
    const setCookie = r.headers['set-cookie'];
    expect(String(setCookie)).toMatch(/Max-Age=0/i);
  });

  // 이슈 #331 — 비밀번호 변경(token_version bump) 후 기존 JWT 세션 즉시 무효화.
  it('/api/protected — token_version bump 후 기존 토큰 401', async () => {
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
    repo.bumpTokenVersion(user.id);
    const r = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(r.statusCode).toBe(401);
  });

  it('/api/protected — 존재하지 않는 사용자 sub → 401', async () => {
    const token = signSessionToken({ sub: '9999', username: 'ghost@x.y', tv: 0 });
    const r = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { [SESSION_COOKIE_NAME]: token },
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
