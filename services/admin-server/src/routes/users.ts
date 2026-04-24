import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserRepository } from '../db/user-repo.js';
import { hashPassword } from '../auth/password.js';

// Task 4 와 동일한 permissive email 검증 — z.string().email() 의 strict 정책은
// 단일 문자 TLD(예: a@b.c)를 거부해 내부망 호환성/테스트가 깨진다.
const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createSchema = z.object({
  username: z.string().regex(EMAIL_LIKE_RE).max(254),
  password: z.string().min(8).max(256),
});

const passwordSchema = z.object({
  password: z.string().min(8).max(256),
});

function publicUser(u: {
  id: number; username: string; created_at: string; updated_at: string;
  disabled_at: string | null; last_login_at: string | null;
}) {
  return {
    id: u.id,
    username: u.username,
    created_at: u.created_at,
    updated_at: u.updated_at,
    disabled_at: u.disabled_at,
    last_login_at: u.last_login_at,
  };
}

/**
 * 사용자 CRUD 라우트 — 모두 requireAuth 훅의 보호를 받는다.
 * - GET    /api/users          — 전체 목록 (password_hash 제외)
 * - POST   /api/users          — 신규 생성
 * - PUT    /api/users/:id/password — 비밀번호 변경
 * - DELETE /api/users/:id      — 비활성(soft delete), 자기 자신은 거부
 */
export const usersRoutes: FastifyPluginAsync<{ userRepo: UserRepository }> = async (app, opts) => {
  const { userRepo } = opts;

  app.get('/api/users', async () => {
    return userRepo.list().map(publicUser);
  });

  app.post('/api/users', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    if (userRepo.findByUsername(parsed.data.username)) {
      return reply.code(409).send({ error: 'username_already_exists' });
    }
    const hash = await hashPassword(parsed.data.password);
    const u = userRepo.create(parsed.data.username, hash);
    return reply.code(201).send(publicUser(u));
  });

  app.put<{ Params: { id: string } }>('/api/users/:id/password', async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const id = Number(req.params.id);
    if (!userRepo.findById(id)) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    const hash = await hashPassword(parsed.data.password);
    userRepo.updatePassword(id, hash);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const id = Number(req.params.id);
    // 자기 자신을 비활성화하면 즉시 시스템 락아웃 위험 → 막는다.
    if (req.user && Number(req.user.sub) === id) {
      return reply.code(400).send({ error: 'cannot_disable_self' });
    }
    if (!userRepo.findById(id)) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    userRepo.disable(id);
    return { ok: true };
  });
};
