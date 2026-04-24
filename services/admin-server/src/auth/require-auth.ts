import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifySessionToken, SESSION_COOKIE_NAME, type SessionClaims } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionClaims;
  }
}

/**
 * preHandler 훅 — JWT 쿠키 기반 인증. 아래 경로는 스킵한다:
 * - /internal/* (별도 requireInternalToken 훅)
 * - /api/health
 * - /api/auth/*  (login/logout/setup/state)
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = req.url;
  if (
    url.startsWith('/internal/') ||
    url === '/api/health' ||
    url.startsWith('/api/auth/')
  ) {
    return;
  }

  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }

  const claims = verifySessionToken(token);
  if (!claims) {
    reply.code(401).send({ error: 'unauthenticated' });
    return;
  }

  req.user = claims;
}
