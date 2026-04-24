import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { authRoutes } from './auth.js';
import { UserRepository, USER_SCHEMA } from '../db/user-repo.js';
import { requireAuth } from '../auth/require-auth.js';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/jwt.js';
import { hashPassword } from '../auth/password.js';

async function buildApp(): Promise<{ app: FastifyInstance; userRepo: UserRepository }> {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  const db = new Database(':memory:');
  db.exec(USER_SCHEMA);
  const userRepo = new UserRepository(db);

  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', requireAuth);
  await app.register(authRoutes, { userRepo });
  return { app, userRepo };
}

describe('authRoutes', () => {
  let app: FastifyInstance;
  let userRepo: UserRepository;
  beforeEach(async () => {
    ({ app, userRepo } = await buildApp());
  });

  describe('GET /api/auth/state', () => {
    it('users 비었음 → needs_setup', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/auth/state' });
      expect(r.statusCode).toBe(200);
      expect(r.json().state).toBe('needs_setup');
    });

    it('users 존재 + 쿠키 없음 → needs_login', async () => {
      userRepo.create('a@b.c', await hashPassword('p'));
      const r = await app.inject({ method: 'GET', url: '/api/auth/state' });
      expect(r.json().state).toBe('needs_login');
    });

    it('유효 쿠키 → authenticated + user 반환', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p'));
      const token = signSessionToken({ sub: String(u.id), username: u.username });
      const r = await app.inject({
        method: 'GET', url: '/api/auth/state',
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      const body = r.json();
      expect(body.state).toBe('authenticated');
      expect(body.user.username).toBe('a@b.c');
    });
  });

  describe('POST /api/auth/setup', () => {
    it('빈 테이블에서 성공', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { username: 'admin@school.local', password: 'password1' },
      });
      expect(r.statusCode).toBe(201);
      expect(r.cookies.some(c => c.name === SESSION_COOKIE_NAME)).toBe(true);
      expect(userRepo.count()).toBe(1);
    });

    it('이미 사용자 존재하면 409', async () => {
      userRepo.create('x@y.z', await hashPassword('p'));
      const r = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { username: 'admin@school.local', password: 'password1' },
      });
      expect(r.statusCode).toBe(409);
    });

    it('email 형식 아니면 400', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { username: 'notanemail', password: 'password1' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('password 8자 미만이면 400', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { username: 'a@b.c', password: 'short' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('올바른 자격 → 200 + 쿠키', async () => {
      userRepo.create('a@b.c', await hashPassword('p1234567'));
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a@b.c', password: 'p1234567' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.cookies.some(c => c.name === SESSION_COOKIE_NAME)).toBe(true);
    });

    it('잘못된 password → 401', async () => {
      userRepo.create('a@b.c', await hashPassword('p1234567'));
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a@b.c', password: 'wrong-pw' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('존재하지 않는 username → 401', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'nobody@nope.io', password: 'anything' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('disabled 계정 → 401', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p1234567'));
      userRepo.disable(u.id);
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a@b.c', password: 'p1234567' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('로그인 성공 시 last_login_at 갱신', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p1234567'));
      expect(u.last_login_at).toBeNull();
      await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a@b.c', password: 'p1234567' },
      });
      expect(userRepo.findById(u.id)?.last_login_at).not.toBeNull();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('쿠키 삭제 헤더 반환', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p1234567'));
      const token = signSessionToken({ sub: String(u.id), username: u.username });
      const r = await app.inject({
        method: 'POST', url: '/api/auth/logout',
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(r.statusCode).toBe(200);
      const sessCookie = r.cookies.find(c => c.name === SESSION_COOKIE_NAME);
      expect(sessCookie?.value).toBe('');
    });
  });
});
