import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import axios from 'axios';
import { DOMAIN_SCHEMA, DomainRepository } from '../db/domain-repo.js';
import { OPTIMIZATION_EVENTS_SCHEMA, OptimizationEventsRepository } from '../db/optimization-events-repo.js';
import { diagnoseRoutes } from './diagnose.js';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

interface BuildOpts {
  domains?: string[];
  storageGetMetadata?: ReturnType<typeof vi.fn>;
}

function buildApp(opts: BuildOpts = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = new Database(':memory:');
  db.exec(DOMAIN_SCHEMA);
  db.exec(OPTIMIZATION_EVENTS_SCHEMA);
  const domainRepo = new DomainRepository(db);
  for (const host of opts.domains ?? []) domainRepo.upsert(host, `https://${host}`);
  const eventsRepo = new OptimizationEventsRepository(db);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('db', db as any);
  app.decorate('proxyAdminUrl', 'http://proxy-mock:8081');
   
  app.decorate('storageClient', {
    getMetadata: opts.storageGetMetadata ?? vi.fn(async () => ({
      exists: false, size_bytes: 0, stored_at: 0, expires_at: 0,
      content_type: '', cached_headers: [],
    })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('optimizationEventsRepo', eventsRepo as any);

  app.register(diagnoseRoutes);
  return app;
}

beforeEach(() => { vi.mocked(axios.get).mockReset(); });

describe('GET /api/domains/:host/diagnose (#387)', () => {
  it('path 미지정 시 400', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose' });
    expect(r.statusCode).toBe(400);
  });

  it('path 가 / 로 시작하지 않으면 400', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=foo' });
    expect(r.statusCode).toBe(400);
  });

  it('range 가 화이트리스트 외면 400', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/p&range=2h' });
    expect(r.statusCode).toBe(400);
  });

  it('등록되지 않은 host 는 404', async () => {
    const app = buildApp({ domains: [] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/unknown.test/diagnose?path=/p' });
    expect(r.statusCode).toBe(404);
  });

  it('proxy + storage + repo 결과를 fan-in 한 JSON 200 을 반환한다', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: {
      current_state: 'HIT', layer: 'L2', l1_hit: false, l2_hit: true, bypass_count_recent: 0,
    }});
    const getMetadataMock = vi.fn(async () => ({
      exists: true, size_bytes: 1234, stored_at: 1778645000, expires_at: 1778731400,
      content_type: 'video/mp4',
      cached_headers: [{ name: 'content-type', value: 'video/mp4' }],
    }));
    const app = buildApp({ domains: ['x.test'], storageGetMetadata: getMetadataMock });

    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/v.mp4&range=1h' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.cdn).toMatchObject({ current_state: 'HIT', layer: 'L2' });
    expect(body.cache_copy).toMatchObject({ exists: true, size_bytes: 1234 });
    expect(body.response_headers).toEqual([{ name: 'content-type', value: 'video/mp4' }]);
    expect(body.range).toBeDefined();
    expect(body.origin).toBeDefined();
    expect(getMetadataMock).toHaveBeenCalled();
  });

  it('proxy 호출 실패 시 cdn 필드는 null 이고 200 을 유지한다', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('offline'));
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/v.mp4' });
    expect(r.statusCode).toBe(200);
    expect(r.json().cdn).toBeNull();
  });
});
