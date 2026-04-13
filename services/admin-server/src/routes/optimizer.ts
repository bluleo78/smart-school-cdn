// 최적화 프로파일 + 절감 통계 API 라우트
import type { FastifyInstance } from 'fastify';
import type { OptimizerClient } from '../grpc/optimizer_client.js';

declare module 'fastify' {
  interface FastifyInstance {
    optimizerClient: OptimizerClient;
  }
}

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
  }>('/api/optimizer/profiles/:domain', async (req, reply) => {
    const { domain } = req.params;
    const { quality, max_width, enabled } = req.body;
    await app.optimizerClient.setProfile({ domain, quality, max_width, enabled });
    return reply.status(204).send();
  });

  /** 도메인별 최적화 절감 통계 조회 */
  app.get('/api/stats/optimization', async (_req, reply) => {
    try {
      const result = await app.optimizerClient.getStats();
      return reply.send(result);
    } catch {
      return reply.send({ stats: [] });
    }
  });
}
