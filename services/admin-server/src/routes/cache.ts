/// 캐시 관리 API 라우트
/// Proxy Service 관리 API(8081)를 폴링/전달하여 Dashboard에 통계를 제공한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';
const TIMEOUT_MS = 3000;

export async function cacheRoutes(app: FastifyInstance) {
  /** 캐시 통계 — 히트율, 총 용량, 도메인별 통계, 히트율 히스토리 */
  app.get('/api/cache/stats', async () => {
    try {
      const res = await axios.get(`${PROXY_ADMIN_URL}/cache/stats`, { timeout: TIMEOUT_MS });
      return res.data;
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
  app.get('/api/cache/popular', async () => {
    try {
      const res = await axios.get(`${PROXY_ADMIN_URL}/cache/popular`, { timeout: TIMEOUT_MS });
      return res.data;
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
      const res = await axios.delete(`${PROXY_ADMIN_URL}/cache/purge`, {
        data: { type, target },
        timeout: TIMEOUT_MS,
      });
      return res.data;
    } catch {
      return reply.status(502).send({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    }
  });
}
