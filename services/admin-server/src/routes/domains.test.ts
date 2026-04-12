import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DomainRepository, DOMAIN_SCHEMA } from '../db/domain-repo.js';
import { domainRoutes } from './domains.js';

// Proxy admin API push 모킹
vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ status: 200 }) },
}));

function buildApp(domainRepo: DomainRepository) {
  const app = Fastify({ logger: false });
  app.register(domainRoutes, { domainRepo });
  return app;
}

function makeRepo() {
  const db = new Database(':memory:');
  db.exec(DOMAIN_SCHEMA);
  return new DomainRepository(db);
}

describe('GET /api/domains', () => {
  it('빈 목록을 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('등록된 도메인 목록을 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].host).toBe('httpbin.org');
  });
});

describe('POST /api/domains', () => {
  it('도메인을 추가하고 201 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.host).toBe('textbook.com');
    expect(body.origin).toBe('https://textbook.com');
  });

  it('host 없으면 400 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/domains/:host', () => {
  it('존재하는 도메인을 삭제하고 204 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'DELETE', url: '/api/domains/httpbin.org' });
    expect(res.statusCode).toBe(204);
    expect(repo.findByHost('httpbin.org')).toBeUndefined();
  });

  it('없는 도메인 삭제 시 404 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({ method: 'DELETE', url: '/api/domains/notexist.com' });
    expect(res.statusCode).toBe(404);
  });
});
