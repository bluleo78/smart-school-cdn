import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

/**
 * preHandler 훅 — /internal/* 경로에 대해 X-Internal-Token 헤더를 INTERNAL_API_TOKEN 과
 * constant-time 비교. 길이가 다르면 즉시 401.
 */
export async function requireInternalToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.url.startsWith('/internal/')) {
    return;
  }

  const expected = process.env.INTERNAL_API_TOKEN ?? '';
  const provided = (req.headers['x-internal-token'] as string | undefined) ?? '';

  if (expected.length === 0) {
    req.log.warn('INTERNAL_API_TOKEN 미설정 — /internal/* 접근 거부');
    reply.code(401).send({ error: 'internal_token_misconfigured' });
    return;
  }

  if (expected.length !== provided.length) {
    reply.code(401).send({ error: 'internal_token_mismatch' });
    return;
  }

  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!ok) {
    reply.code(401).send({ error: 'internal_token_mismatch' });
    return;
  }
}
