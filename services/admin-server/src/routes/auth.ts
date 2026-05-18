import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserRepository } from '../db/user-repo.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  signSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
} from '../auth/jwt.js';

// 단순 email 형태 검증 — local@domain. zod 의 strict email 정책은 단일 문자 TLD 등을
// 거부하므로 내부망 운영자 username 호환성을 위해 최소 형태만 강제한다.
const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// username 정규화 — setup/login 모두 동일 규칙(trim + lower-case)을 적용해야
// 같은 사람이 대소문자만 다른 별도 계정으로 분리되거나, 케이스 차이로 로그인
// 매칭이 어긋나는 것을 막는다 (#190).
function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

const credentialSchema = z.object({
  username: z.string().min(3).max(254).regex(EMAIL_LIKE_RE).transform(normalizeUsername),
  password: z.string().min(8).max(256),
});

/**
 * auth 응답 직렬화 — last_login_at 그대로 전달 (#342, #377).
 * #377 이후 DB 컬럼이 INTEGER unix-sec 이라 별도 변환 불필요.
 */
function publicUser(u: { id: number; username: string; last_login_at: number | null }) {
  return { id: u.id, username: u.username, last_login_at: u.last_login_at };
}

export const authRoutes: FastifyPluginAsync<{ userRepo: UserRepository }> = async (app, opts) => {
  const { userRepo } = opts;

  // 현재 인증 상태 조회 — /api/auth/* 는 requireAuth 가 스킵하므로
  // 여기서 직접 쿠키를 확인해 사용자 상태를 판단한다.
  app.get('/api/auth/state', async (req) => {
    if (userRepo.count() === 0) {
      return { state: 'needs_setup' as const };
    }
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    const claims = token ? verifySessionToken(token) : null;
    if (!claims) {
      return { state: 'needs_login' as const };
    }
    const u = userRepo.findById(Number(claims.sub));
    // 이슈 #330/#331 — disabled_at 또는 token_version 불일치 시 needs_login 으로 분류.
    if (!u || u.disabled_at !== null || u.token_version !== claims.tv) {
      return { state: 'needs_login' as const };
    }
    return { state: 'authenticated' as const, user: publicUser(u) };
  });

  // 최초 관리자 등록 (users 비어있을 때만)
  app.post('/api/auth/setup', async (req, reply) => {
    const parsed = credentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    if (userRepo.count() !== 0) {
      return reply.code(409).send({ error: 'setup_already_completed' });
    }
    const hash = await hashPassword(parsed.data.password);
    const user = userRepo.create(parsed.data.username, hash);
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
    reply.setCookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions());
    return reply.code(201).send({ user: publicUser(user) });
  });

  // 로그인 — IP당 15분에 최대 10회로 rate limit 적용 (브루트포스 방지).
  // @fastify/rate-limit 의 per-route config 를 통해 이 엔드포인트만 제한하며,
  // Retry-After 헤더는 플러그인이 자동으로 포함한다.
  app.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip,
      },
    },
  }, async (req, reply) => {
    const parsed = credentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const user = userRepo.findByUsername(parsed.data.username);
    if (!user || user.disabled_at !== null) {
      // timing 보호를 위해 dummy verify 실행
      await hashPassword(parsed.data.password);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const ok = await verifyPassword(user.password_hash, parsed.data.password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    userRepo.updateLastLogin(user.id);
    const token = signSessionToken({ sub: String(user.id), username: user.username, tv: user.token_version });
    reply.setCookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions());
    return { user: publicUser(user) };
  });

  // 로그아웃 — 쿠키 삭제
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.setCookie(SESSION_COOKIE_NAME, '', {
      ...buildSessionCookieOptions(),
      maxAge: 0,
    });
    return { ok: true };
  });
};
