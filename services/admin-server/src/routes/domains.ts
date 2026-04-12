/// 도메인 관리 API 라우트
/// Admin Server가 도메인의 소유자 — 변경 시 Proxy admin API(8081)에 전체 목록 push
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import type { DomainRepository } from '../db/domain-repo.js';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';

/** 현재 전체 도메인 목록을 Proxy admin API에 push (실패 시 로그만, 클라이언트는 성공) */
export async function syncToProxy(domainRepo: DomainRepository): Promise<void> {
  try {
    const domains = domainRepo.findAll().map(({ host, origin }) => ({ host, origin }));
    await axios.post(`${PROXY_ADMIN_URL}/domains`, { domains }, { timeout: 3000 });
    console.log(`[sync] Proxy에 도메인 ${domains.length}건 동기화 완료`);
  } catch (err) {
    console.error('[sync] Proxy 도메인 동기화 실패:', err instanceof Error ? err.message : err);
  }
}

export async function domainRoutes(
  app: FastifyInstance,
  { domainRepo }: { domainRepo: DomainRepository },
) {
  /** 전체 도메인 목록 조회 */
  app.get('/api/domains', async () => {
    return domainRepo.findAll();
  });

  /** 도메인 추가 (이미 있으면 origin 갱신) */
  app.post<{ Body: { host?: string; origin?: string } }>(
    '/api/domains',
    async (request, reply) => {
      const { host, origin } = request.body ?? {};
      if (!host || !origin) {
        return reply.status(400).send({ error: 'host와 origin은 필수 항목입니다.' });
      }
      domainRepo.upsert(host, origin);
      await syncToProxy(domainRepo);
      return reply.status(201).send(domainRepo.findByHost(host));
    },
  );

  /** 도메인 삭제 */
  app.delete<{ Params: { host: string } }>('/api/domains/:host', async (request, reply) => {
    const { host } = request.params;
    const deleted = domainRepo.delete(host);
    if (deleted === 0) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    await syncToProxy(domainRepo);
    return reply.status(204).send();
  });
}
