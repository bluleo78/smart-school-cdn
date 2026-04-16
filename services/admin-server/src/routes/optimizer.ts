// 최적화 프로파일 + 절감 통계 API 라우트
import type { FastifyInstance } from 'fastify';
import type { OptimizerClient } from '../grpc/optimizer_client.js';

declare module 'fastify' {
  interface FastifyInstance {
    optimizerClient: OptimizerClient;
  }
}

/** PUT /api/optimizer/profiles/:domain 요청 바디 스키마 */
const profileBodySchema = {
  type: 'object',
  required: ['quality', 'max_width', 'enabled'],
  properties: {
    quality:   { type: 'integer', minimum: 1, maximum: 100 },
    max_width: { type: 'integer', minimum: 0, maximum: 65535 },
    enabled:   { type: 'boolean' },
  },
  additionalProperties: false,
};

export async function optimizerRoutes(app: FastifyInstance) {
  /** 도메인별 최적화 프로파일 목록 조회 */
  app.get('/api/optimizer/profiles', async (_req, reply) => {
    try {
      const result = await app.optimizerClient.getProfiles();
      return reply.send(result);
    } catch {
      return reply.send({ profiles: [] });
    }
  });

  /** 도메인 최적화 프로파일 수정 */
  app.put<{
    Params: { domain: string };
    Body: { quality: number; max_width: number; enabled: boolean };
  }>('/api/optimizer/profiles/:domain', { schema: { body: profileBodySchema } }, async (req, reply) => {
    const { domain } = req.params;
    const { quality, max_width, enabled } = req.body;
    await app.optimizerClient.setProfile({ domain, quality, max_width, enabled });
    return reply.status(204).send();
  });

  /** 도메인별 최적화 절감 통계 조회 — domain 쿼리로 특정 도메인만 필터링 가능 */
  app.get<{ Querystring: { domain?: string } }>('/api/stats/optimization', async (req, reply) => {
    try {
      const result = await app.optimizerClient.getStats();
      const { domain } = req.query;
      if (domain && Array.isArray(result.stats)) {
        return reply.send({ stats: result.stats.filter((s: { domain?: string }) => s.domain === domain) });
      }
      return reply.send(result);
    } catch {
      return reply.send({ stats: [] });
    }
  });
}
