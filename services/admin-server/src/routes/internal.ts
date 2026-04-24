import type { FastifyPluginAsync } from 'fastify';
import type { DomainRepository } from '../db/domain-repo.js';

/**
 * 서비스간 내부 호출 전용 라우트 — `/internal/*` 경로는
 * `requireInternalToken` 훅이 X-Internal-Token 헤더로 보호한다.
 *
 * Phase 16-2: 기존 `/api/domains/internal/snapshot` 을 인증 보호 영역으로 이동.
 *  - proxy 기동 시 활성·비활성 도메인 전체를 host/origin/enabled/description
 *    필드로 pull 한다 (응답 형태는 기존과 동일).
 */
export const internalRoutes: FastifyPluginAsync<{ domainRepo: DomainRepository }> = async (app, opts) => {
  const { domainRepo } = opts;

  /** proxy 기동 시 도메인 맵 초기 pull 전용 read-only 엔드포인트 */
  app.get('/internal/domains/snapshot', async () => {
    const rows = domainRepo.findAll();
    return {
      domains: rows.map((d) => ({
        host: d.host,
        origin: d.origin,
        enabled: d.enabled === 1,
        description: d.description,
      })),
    };
  });
};
