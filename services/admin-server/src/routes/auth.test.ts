import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import { authRoutes } from './auth.js';
import { UserRepository, USER_SCHEMA } from '../db/user-repo.js';
import { createRequireAuth } from '../auth/require-auth.js';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/jwt.js';
import { hashPassword } from '../auth/password.js';
import { registerErrorHandlers } from '../error-handlers.js';

async function buildApp(): Promise<{ app: FastifyInstance; userRepo: UserRepository }> {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  const db = new Database(':memory:');
  db.exec(USER_SCHEMA);
  const userRepo = new UserRepository(db);

  const app = Fastify();
  await app.register(cookie);
  // rate-limit 플러그인 등록 — global: false 로 라우트 개별 설정만 동작.
  // 테스트 환경에서는 낮은 windowMs 를 사용해 테스트 속도를 유지한다.
  // errorResponseBuilder 는 prod(index.ts)와 동일하게 표준 envelope({error,message}) 강제 (#416).
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => {
      const err = new Error(`요청이 너무 잦습니다. ${ctx.after} 후 다시 시도하세요.`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 429;
      err.code = 'rate_limit_exceeded';
      return err;
    },
  });
  // setErrorHandler — prod 와 동일하게 4xx envelope 매핑을 거치도록 등록 (#327).
  registerErrorHandlers(app);
  app.addHook('preHandler', createRequireAuth(userRepo));
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
      const token = signSessionToken({ sub: String(u.id), username: u.username, tv: u.token_version });
      const r = await app.inject({
        method: 'GET', url: '/api/auth/state',
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      const body = r.json();
      expect(body.state).toBe('authenticated');
      expect(body.user.username).toBe('a@b.c');
    });

    // 이슈 #330/#331 — token_version bump 후 기존 쿠키는 needs_login 으로 분류된다.
    it('token_version bump 후 기존 쿠키 → needs_login (#331)', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p'));
      const token = signSessionToken({ sub: String(u.id), username: u.username, tv: u.token_version });
      userRepo.bumpTokenVersion(u.id);
      const r = await app.inject({
        method: 'GET', url: '/api/auth/state',
        cookies: { [SESSION_COOKIE_NAME]: token },
      });
      expect(r.json().state).toBe('needs_login');
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

    // 이슈 #190 — setup 단계에서도 username 은 lower-case 로 저장된다
    it('username 대문자 입력은 lower-case 로 저장된다', async () => {
      const r = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { username: 'Admin@SCHOOL.local', password: 'password1' },
      });
      expect(r.statusCode).toBe(201);
      // 저장 시 lower-case 로 정규화됐는지는 row 의 username 필드로 직접 확인.
      // 이슈 #340 이후 findByUsername 은 COLLATE NOCASE 라 대소문자 관계없이 매칭되므로
      // 조회 결과 null 비교만으로는 정규화 여부를 판정할 수 없다.
      const found = userRepo.findByUsername('admin@school.local');
      expect(found).not.toBeNull();
      expect(found?.username).toBe('admin@school.local');
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

    // 이슈 #190 — 대소문자 다른 입력으로도 동일 계정에 로그인된다
    it('대문자 입력 username 으로도 로그인 성공 (case-insensitive)', async () => {
      userRepo.create('a@b.c', await hashPassword('p1234567'));
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'A@B.C', password: 'p1234567' },
      });
      expect(r.statusCode).toBe(200);
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

    // rate limit: 동일 IP 에서 10회 실패 후 11번째는 429 반환 (브루트포스 차단)
    it('10회 실패 후 11번째 요청 → 429 + Retry-After 헤더', async () => {
      userRepo.create('a@b.c', await hashPassword('p1234567'));
      // 10회 실패 소진
      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: 'POST', url: '/api/auth/login',
          payload: { username: 'a@b.c', password: 'wrongpassword' },
          headers: { 'x-forwarded-for': '10.0.0.1' },
        });
      }
      // 11번째 요청은 rate limit 초과 → 429
      const r = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a@b.c', password: 'wrongpassword' },
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
      expect(r.statusCode).toBe(429);
      expect(r.headers['retry-after']).toBeDefined();
      // 표준 에러 envelope({error, message}) 준수 (#327, #416).
      // raw Fastify shape({statusCode, error: 'Too Many Requests', message}) 는 금지.
      const body = r.json();
      expect(body.error).toBe('rate_limit_exceeded');
      expect(typeof body.message).toBe('string');
      expect(body.message).toMatch(/요청이 너무 잦습니다/);
      expect(body.statusCode).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('쿠키 삭제 헤더 반환', async () => {
      const u = userRepo.create('a@b.c', await hashPassword('p1234567'));
      const token = signSessionToken({ sub: String(u.id), username: u.username, tv: u.token_version });
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
