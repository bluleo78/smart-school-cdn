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
  it('path 미지정 시 400 — 표준 envelope({error: invalid_input, message}) 반환 (#407)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose' });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.error).toBe('invalid_input');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('path 가 / 로 시작하지 않으면 400 — 표준 envelope (#407)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=foo' });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.error).toBe('invalid_input');
    // zod issue 의 message 가 그대로 노출 (사람 가독)
    expect(body.message).toBe('path must start with /');
  });

  it('range 가 화이트리스트 외면 400 — 표준 envelope (#407)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/p&range=2h' });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.error).toBe('invalid_input');
    expect(typeof body.message).toBe('string');
  });

  it('등록되지 않은 host 는 404 — 표준 envelope({error: domain_not_found, message}) 반환 (#407)', async () => {
    const app = buildApp({ domains: [] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/unknown.test/diagnose?path=/p' });
    expect(r.statusCode).toBe(404);
    const body = r.json();
    expect(body.error).toBe('domain_not_found');
    expect(body.message).toBe('도메인을 찾을 수 없습니다.');
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

  // #396 — path/query 입력 hygiene: 제어문자·fragment·길이 상한 검증
  it('path 에 제어문자(CRLF) 포함 시 400 (#396)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    // %0A 는 라우터에서 디코딩되어 zod regex 에 LF 그대로 도달
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/x%0AHost:evil' });
    expect(r.statusCode).toBe(400);
  });

  it('path 에 fragment(#) 포함 시 400 (#396)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/video.mp4%23frag' });
    expect(r.statusCode).toBe(400);
  });

  it('path 길이 상한(2048 bytes) 초과 시 400 (#396)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const longPath = '/' + 'a'.repeat(2048); // 2049 bytes
    const r = await app.inject({ method: 'GET', url: `/api/domains/x.test/diagnose?path=${longPath}` });
    expect(r.statusCode).toBe(400);
  });

  it('query 에 제어문자 포함 시 400 (#396)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/p&query=a%0Ab' });
    expect(r.statusCode).toBe(400);
  });

  it('query 에 fragment(#) 포함 시 400 (#396)', async () => {
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/p&query=a%23b' });
    expect(r.statusCode).toBe(400);
  });

  // 이슈 #403 — proxy 가 저장하는 event url 은 path+query 만 (origin-form),
  // admin 도 같은 표현으로 lookup 해야 sample/range/hit_ratio 가 0 이 아닌 실제 값으로 잡힌다.
  it('events lookup 은 path+query 표현으로 매치된다 (#403)', async () => {
    const app = buildApp({ domains: ['httpbin.org'] });
    // proxy 가 emit 한 형태(path-only url)로 직접 이벤트 1건 삽입 — repo 가 url_hash 까지 채움
    const repo = (app as unknown as { optimizationEventsRepo: OptimizationEventsRepository })
      .optimizationEventsRepo;
    repo.insertBatch([{
      ts: new Date().toISOString(),
      event_type: 'media_cache',
      host: 'httpbin.org',
      url: '/images/logo.png',
      decision: 'served_200',
      orig_size: 100, out_size: 100,
      range_header: null,
      content_type: 'image/png',
      elapsed_ms: 20,
    }]);
    const r = await app.inject({
      method: 'GET',
      url: '/api/domains/httpbin.org/diagnose?path=/images/logo.png&range=1h',
    });
    expect(r.statusCode).toBe(200);
    // 이전 구현은 fullUrl=https://... 로 hash 미스 → sample_count=0 이었다.
    expect(r.json().sample_count).toBe(1);
  });

  it('proxy 호출 실패 시 cdn 필드는 null 이고 200 을 유지한다', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('offline'));
    const app = buildApp({ domains: ['x.test'] });
    const r = await app.inject({ method: 'GET', url: '/api/domains/x.test/diagnose?path=/v.mp4' });
    expect(r.statusCode).toBe(200);
    expect(r.json().cdn).toBeNull();
  });
});
