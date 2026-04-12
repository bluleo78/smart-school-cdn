import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DomainRepository, DOMAIN_SCHEMA } from '../db/domain-repo.js';
import { domainRoutes } from './domains.js';

// Proxy admin API push 모킹
vi.mock('axios', () => ({
  default: { post: vi.fn().mockResolvedValue({ status: 200 }) },
}));

/** tls-service / dns-service gRPC 팬아웃 mock */
const mockTlsClient = { syncDomains: vi.fn().mockResolvedValue({ success: true }) };
const mockDnsClient = { syncDomains: vi.fn().mockResolvedValue({ success: true }) };

function buildApp(domainRepo: DomainRepository) {
  const app = Fastify({ logger: false });
  // gRPC 클라이언트 데코레이터 — 도메인 변경 시 팬아웃 호출됨
  app.decorate('tlsClient', mockTlsClient);
  app.decorate('dnsClient', mockDnsClient);
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

  it('origin 없으면 400 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('동일 host POST 시 origin이 갱신된다 (upsert)', async () => {
    const repo = makeRepo();
    repo.upsert('textbook.com', 'https://old.textbook.com');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://new.textbook.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.findByHost('textbook.com')?.origin).toBe('https://new.textbook.com');
  });

  it('도메인 추가 시 syncToProxy가 올바른 payload로 호출된다', async () => {
    const axiosMod = await import('axios');
    const postSpy = vi.mocked(axiosMod.default.post);
    postSpy.mockClear();

    const repo = makeRepo();
    const app = buildApp(repo);
    await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining('/domains'),
      { domains: [{ host: 'textbook.com', origin: 'https://textbook.com' }] },
      expect.any(Object),
    );
  });

  it('syncToProxy 실패해도 클라이언트에는 201을 반환한다', async () => {
    const axiosMod = await import('axios');
    vi.mocked(axiosMod.default.post).mockRejectedValueOnce(new Error('Network error'));

    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('도메인 추가 시 tls-service와 dns-service에 syncDomains가 호출된다', async () => {
    mockTlsClient.syncDomains.mockClear();
    mockDnsClient.syncDomains.mockClear();

    const repo = makeRepo();
    const app = buildApp(repo);
    await app.inject({
      method: 'POST', url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });

    expect(mockTlsClient.syncDomains).toHaveBeenCalledWith(
      expect.arrayContaining([{ host: 'textbook.com', origin: 'https://textbook.com' }]),
    );
    expect(mockDnsClient.syncDomains).toHaveBeenCalled();
  });

  it('gRPC 팬아웃 실패해도 클라이언트에는 201을 반환한다', async () => {
    mockTlsClient.syncDomains.mockRejectedValueOnce(new Error('UNAVAILABLE'));

    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(201);
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

  it('와일드카드 도메인 URL 인코딩(%2A) 삭제 시 204 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('*.textbook.com', 'https://textbook.com');
    const app = buildApp(repo);
    // *.textbook.com → URL 인코딩 → %2A.textbook.com
    const res = await app.inject({ method: 'DELETE', url: '/api/domains/%2A.textbook.com' });
    expect(res.statusCode).toBe(204);
    expect(repo.findByHost('*.textbook.com')).toBeUndefined();
  });
});
