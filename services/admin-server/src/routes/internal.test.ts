import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DomainRepository, DOMAIN_SCHEMA } from '../db/domain-repo.js';
import { internalRoutes } from './internal.js';

/**
 * Task 6: `/internal/domains/snapshot` 라우트 — 기존 `/api/domains/internal/snapshot`
 * 의 응답 형태를 그대로 유지하면서 인증 보호 영역(`/internal/*`)으로 이전했다.
 *
 * 본 스위트는 라우트 자체의 응답만 검증하고, requireInternalToken 훅은
 * 별도 `auth/hooks.test.ts` 에서 다룬다 (분리 검증으로 회귀 추적이 쉬워짐).
 */

function makeRepo() {
  const db = new Database(':memory:');
  db.exec(DOMAIN_SCHEMA);
  return new DomainRepository(db);
}

function buildApp(domainRepo: DomainRepository) {
  const app = Fastify({ logger: false });
  app.register(internalRoutes, { domainRepo });
  return app;
}

describe('GET /internal/domains/snapshot', () => {
  it('활성·비활성 도메인 전체를 host/origin/enabled/description 필드로 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.origin.test', 'alpha');
    repo.upsert('b.test', 'https://b.origin.test', 'beta');
    repo.update('b.test', { enabled: 0 });
    const app = buildApp(repo);

    const res = await app.inject({ method: 'GET', url: '/internal/domains/snapshot' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      domains: Array<{ host: string; origin: string; enabled: boolean; description: string }>;
    };
    expect(body.domains).toHaveLength(2);
    const a = body.domains.find((d) => d.host === 'a.test');
    const b = body.domains.find((d) => d.host === 'b.test');
    expect(a).toMatchObject({ origin: 'https://a.origin.test', enabled: true,  description: 'alpha' });
    expect(b).toMatchObject({ origin: 'https://b.origin.test', enabled: false, description: 'beta'  });
  });

  it('빈 DB에서도 {domains: []} 형태로 응답한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/internal/domains/snapshot' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [] });
  });
});
