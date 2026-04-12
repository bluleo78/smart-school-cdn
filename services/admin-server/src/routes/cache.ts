/// 캐시 관리 API 라우트
/// storage-service gRPC(50051)를 통해 캐시 통계/인기 콘텐츠/퍼지를 제공한다.
import type { FastifyInstance } from 'fastify';

export async function cacheRoutes(app: FastifyInstance) {
  /** 캐시 통계 — 히트율, 총 용량, 도메인별 통계 */
  app.get('/api/cache/stats', async () => {
    try {
      const res = await app.storageClient.stats();
      return res;
    } catch {
      return {
        hit_count: 0,
        miss_count: 0,
        bypass_count: 0,
        hit_rate: 0,
        total_size_bytes: 0,
        max_size_bytes: 0,
        entry_count: 0,
        by_domain: [],
        hit_rate_history: [],
      };
    }
  });

  /** 인기 콘텐츠 목록 — hit_count 내림차순 상위 20개 */
  app.get<{ Querystring: { limit?: string } }>('/api/cache/popular', async (request) => {
    try {
      const limit = Number(request.query.limit ?? 20);
      const res = await app.storageClient.popular(limit);
      return res.entries ?? [];
    } catch {
      return [];
    }
  });

  /** 캐시 퍼지 — URL / 도메인 / 전체 */
  app.delete<{
    Body: { type: 'url' | 'domain' | 'all'; target?: string };
  }>('/api/cache/purge', async (request, reply) => {
    const { type, target } = request.body;
    if (!type) {
      return reply.status(400).send({ error: 'type은 필수입니다.' });
    }
    if ((type === 'url' || type === 'domain') && !target) {
      return reply.status(400).send({ error: `type이 "${type}"이면 target은 필수입니다.` });
    }
    try {
      let res;
      if (type === 'url') {
        res = await app.storageClient.purgeUrl(target!);
      } else if (type === 'domain') {
        res = await app.storageClient.purgeDomain(target!);
      } else {
        res = await app.storageClient.purgeAll();
      }
      return res;
    } catch {
      return reply.status(502).send({ error: 'storage-service에 연결할 수 없습니다.' });
    }
  });
}
