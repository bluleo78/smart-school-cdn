import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserRepository } from '../db/user-repo.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

// Task 4 와 동일한 permissive email 검증 — z.string().email() 의 strict 정책은
// 단일 문자 TLD(예: a@b.c)를 거부해 내부망 호환성/테스트가 깨진다.
const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createSchema = z.object({
  username: z.string().regex(EMAIL_LIKE_RE).max(254),
  password: z.string().min(8).max(256),
});

// 자기 자신 비밀번호 변경 시: currentPassword 필수. 다른 사용자 변경 시: 불필요.
// discriminatedUnion 대신 단일 스키마로 받고 핸들러에서 분기한다.
const passwordSchema = z.object({
  password: z.string().min(8).max(256),
  currentPassword: z.string().min(1).max(256).optional(),
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
 * - GET    /api/users               — 전체 목록 (password_hash 제외)
 * - POST   /api/users               — 신규 생성
 * - PUT    /api/users/:id/password  — 비밀번호 변경
 * - PUT    /api/users/:id/enable    — 비활성 사용자 재활성화
 * - DELETE /api/users/:id           — 비활성(soft delete), 자기 자신은 거부
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
    const targetUser = userRepo.findById(id);
    if (!targetUser) {
      return reply.code(404).send({ error: 'user_not_found' });
    }

    // 자기 자신의 비밀번호를 변경하는 경우: 현재 비밀번호 검증 필수
    // → 현재 비밀번호 없이 자기 계정 탈취 방지 (이슈 #31)
    const isSelf = req.user && Number(req.user.sub) === id;
    if (isSelf) {
      if (!parsed.data.currentPassword) {
        return reply.code(400).send({ error: 'current_password_required' });
      }
      const valid = await verifyPassword(targetUser.password_hash, parsed.data.currentPassword);
      if (!valid) {
        return reply.code(400).send({ error: 'invalid_current_password' });
      }
    }

    const hash = await hashPassword(parsed.data.password);
    userRepo.updatePassword(id, hash);
    return { ok: true };
  });

  // 비활성화된 사용자를 재활성화 — disabled_at 을 NULL 로 초기화
  app.put<{ Params: { id: string } }>('/api/users/:id/enable', async (req, reply) => {
    const id = Number(req.params.id);
    const user = userRepo.findById(id);
    if (!user) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    if (!user.disabled_at) {
      // 이미 활성 상태인 사용자에게 재활성화를 시도하면 멱등성 보장을 위해 200 반환
      return { ok: true };
    }
    userRepo.enable(id);
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
