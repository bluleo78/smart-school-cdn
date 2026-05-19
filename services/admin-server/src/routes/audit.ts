/// 이슈 #351 — GET /api/audit. 필터 + 페이지네이션.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditRepository } from '../db/audit-repo.js';

const querySchema = z.object({
  action:        z.string().min(1).optional(),
  actor_user_id: z.coerce.number().int().min(1).optional(),
  target_type:   z.string().min(1).optional(),
  target_id:     z.string().min(1).optional(),
  from:          z.coerce.number().int().min(0).optional(),
  to:            z.coerce.number().int().min(0).optional(),
  limit:         z.coerce.number().int().min(1).max(1000).default(50),
  offset:        z.coerce.number().int().min(0).default(0),
});

export const auditRoutes = (opts: { auditRepo: AuditRepository }) =>
  async (app: FastifyInstance) => {
    const { auditRepo } = opts;
    app.get('/api/audit', async (req, reply) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? '잘못된 입력입니다.',
          issues: parsed.error.issues,
        });
      }
      const { rows, total } = auditRepo.query(parsed.data);
      // JSON 직렬화 — before/after_json 은 클라이언트가 표시용으로 파싱
      return reply.send({
        rows: rows.map((r) => ({
          ...r,
          before: r.before_json ? safeParse(r.before_json) : null,
          after:  r.after_json  ? safeParse(r.after_json)  : null,
        })),
        total,
      });
    });
  };

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
