import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { usersRoutes } from './users.js';
import { UserRepository, USER_SCHEMA } from '../db/user-repo.js';
import { requireAuth } from '../auth/require-auth.js';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/jwt.js';
import { hashPassword } from '../auth/password.js';

async function buildApp() {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  const db = new Database(':memory:');
  db.exec(USER_SCHEMA);
  const userRepo = new UserRepository(db);
  const u = userRepo.create('admin@school.local', await hashPassword('password1'));
  const token = signSessionToken({ sub: String(u.id), username: u.username });

  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', requireAuth);
  await app.register(usersRoutes, { userRepo });
  return { app, userRepo, adminId: u.id, cookies: { [SESSION_COOKIE_NAME]: token } };
}

describe('usersRoutes', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    ctx = await buildApp();
  });

  it('GET /api/users — 인증 없으면 401', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users' });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/users — password_hash 제외 반환', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: ctx.cookies });
    expect(r.statusCode).toBe(200);
    const users = r.json();
    expect(users[0].username).toBe('admin@school.local');
    expect('password_hash' in users[0]).toBe(false);
  });

  it('POST /api/users — 정상 생성', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'new@school.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(201);
    expect(ctx.userRepo.count()).toBe(2);
  });

  it('POST /api/users — 중복 username 409', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'admin@school.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('PUT /api/users/:id/password — 성공', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${ctx.adminId}/password`,
      cookies: ctx.cookies,
      payload: { password: 'newpass123' },
    });
    expect(r.statusCode).toBe(200);
    const { verifyPassword } = await import('../auth/password.js');
    const u = ctx.userRepo.findById(ctx.adminId)!;
    expect(await verifyPassword(u.password_hash, 'newpass123')).toBe(true);
  });

  // 이슈 #106 회귀 방지 — PUT /api/users/:id/enable 엔드포인트 누락
  it('PUT /api/users/:id/enable — 비활성 사용자 재활성화', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    ctx.userRepo.disable(other.id);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).not.toBeNull();

    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/enable`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).toBeNull();
  });

  // 이슈 #106 — 이미 활성 사용자에게 enable 호출 시 멱등성 보장
  it('PUT /api/users/:id/enable — 이미 활성 사용자에게 호출해도 200', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/enable`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).toBeNull();
  });

  // 이슈 #106 — 존재하지 않는 사용자에게 enable 호출 시 404
  it('PUT /api/users/:id/enable — 존재하지 않는 사용자 404', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: '/api/users/9999/enable',
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(404);
  });

  it('DELETE /api/users/:id — 다른 계정 비활성', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    const r = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${other.id}`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).not.toBeNull();
  });

  it('DELETE /api/users/:id — 자기 자신은 400', async () => {
    const r = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${ctx.adminId}`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('cannot_disable_self');
  });
});
