import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DomainRepository, DOMAIN_SCHEMA } from '../db/domain-repo.js';
import { DomainStatsRepository } from '../db/domain-stats-repo.js';
import { domainRoutes } from './domains.js';

/** domain_stats 스키마 — 6개 신규 컬럼 포함 */
const DOMAIN_STATS_SCHEMA = `
  CREATE TABLE domain_stats (
    host TEXT NOT NULL, timestamp INTEGER NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_misses INTEGER NOT NULL DEFAULT 0,
    bandwidth INTEGER NOT NULL DEFAULT 0,
    avg_response_time INTEGER NOT NULL DEFAULT 0,
    l1_hits INTEGER NOT NULL DEFAULT 0,
    l2_hits INTEGER NOT NULL DEFAULT 0,
    bypass_method INTEGER NOT NULL DEFAULT 0,
    bypass_nocache INTEGER NOT NULL DEFAULT 0,
    bypass_size INTEGER NOT NULL DEFAULT 0,
    bypass_other INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (host, timestamp)
  );
  CREATE INDEX idx_domain_stats_ts ON domain_stats(timestamp);
`;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('tlsClient', mockTlsClient as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('dnsClient', mockDnsClient as any);
  app.register(domainRoutes, { domainRepo });
  return app;
}

/** access_logs 스키마 — 로그 필터 테스트용 */
const ACCESS_LOGS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    host TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 200,
    cache_status TEXT NOT NULL DEFAULT 'MISS',
    size INTEGER NOT NULL DEFAULT 0
  );
`;

function makeRepo() {
  const db = new Database(':memory:');
  db.exec(DOMAIN_SCHEMA);
  db.exec(DOMAIN_STATS_SCHEMA);
  db.exec(ACCESS_LOGS_SCHEMA);
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

  it('syncToProxy 실패 시 502와 저장된 도메인을 반환한다 (에러 전파)', async () => {
    // Proxy 동기화 실패는 502로 클라이언트에 전파한다 (e011b87: POST 에러 전파).
    // 단, DB에는 이미 upsert되었으므로 응답 본문에 저장된 도메인 정보를 포함한다.
    const axiosMod = await import('axios');
    vi.mocked(axiosMod.default.post).mockRejectedValueOnce(new Error('Network error'));

    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Proxy 동기화 실패');
    expect(body.domain?.host).toBe('textbook.com');
    // DB에는 이미 저장되어 있다 — HealthMonitor가 proxy online 전환 시 재동기화한다
    expect(repo.findByHost('textbook.com')?.origin).toBe('https://textbook.com');
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

describe('GET /api/domains/:host/stats', () => {
  it('GET /api/domains/:host/stats — period=1h 요청에 200 + summary 반환', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/stats?period=1h' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.period).toBe('1h');
    expect(body.summary).toBeDefined();
  });

  it('GET /api/domains/:host/stats — custom + from/to 로 200 반환', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    const res = await app.inject({
      method: 'GET',
      url: `/api/domains/a.test/stats?period=custom&from=${now - 3600}&to=${now}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.period).toBe('custom');
  });

  it('GET /api/domains/:host/stats — custom + 잘못된 from/to 는 400', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/stats?period=custom' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/domains/summary — L1/L2/bypass 비율', () => {
  /**
   * today_l1_hit_rate / today_edge_hit_rate / today_bypass_rate 계산 검증
   * seed: requests=100, l1_hits=60, l2_hits=10, bypass_*=20(5+5+5+5)
   */
  it('today_l1_hit_rate / today_edge_hit_rate / today_bypass_rate 계산', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const statsRepo = new DomainStatsRepository(repo.database);
    // 오늘 자정 버킷에 데이터 삽입
    const todayStart = Math.floor(Date.now() / 1000);
    statsRepo.insert({
      host: 'a.test',
      timestamp: todayStart,
      requests: 100,
      cache_hits: 70,
      cache_misses: 30,
      bandwidth: 1024,
      avg_response_time: 50,
      l1_hits: 60,
      l2_hits: 10,
      bypass_method: 5,
      bypass_nocache: 5,
      bypass_size: 5,
      bypass_other: 5,
    });

    // per-host 직접 검증을 위해 getSummaryAll() 결과를 사용한다
    // (buildApp 호출 없이 repo 메서드 직접 단위 검증)
    const summaries = statsRepo.getSummaryAll();
    const s = summaries.find((x) => x.host === 'a.test');
    expect(s).toBeDefined();
    expect(s!.today_l1_hit_rate).toBeCloseTo(0.60);
    expect(s!.today_edge_hit_rate).toBeCloseTo(0.70);
    expect(s!.today_bypass_rate).toBeCloseTo(0.20);
  });

  it('requests=0 일 때 3개 비율 모두 0 (divide-by-zero 가드)', async () => {
    const repo = makeRepo();
    repo.upsert('b.test', 'https://b.test');
    // 통계 행 미삽입 상태 — divide-by-zero 가드 확인용 삽입
    const statsRepo = new DomainStatsRepository(repo.database);
    statsRepo.insert({
      host: 'b.test',
      timestamp: Math.floor(Date.now() / 1000),
      requests: 0,
      cache_hits: 0,
      cache_misses: 0,
      bandwidth: 0,
      avg_response_time: 0,
      l1_hits: 0,
      l2_hits: 0,
      bypass_method: 0,
      bypass_nocache: 0,
      bypass_size: 0,
      bypass_other: 0,
    });
    const summaries2 = statsRepo.getSummaryAll();
    const s = summaries2.find((x) => x.host === 'b.test');
    expect(s).toBeDefined();
    expect(s!.today_l1_hit_rate).toBe(0);
    expect(s!.today_edge_hit_rate).toBe(0);
    expect(s!.today_bypass_rate).toBe(0);
  });
});

describe('GET /api/domains/:host/logs — period/from/to/q 필터', () => {
  it('period=1h 으로 최근 1시간만 반환', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/old', 200, 'MISS', 100),
              (?, 'a.test', 'GET', '/new', 200, 'HIT', 200)`,
    ).run(now - 7200, now - 600);

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?period=1h' });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows.every((r: { path: string }) => r.path === '/new')).toBe(true);
  });

  it('period=custom + from/to 기간만 반환', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/old', 200, 'MISS', 100),
              (?, 'a.test', 'GET', '/new', 200, 'HIT', 200)`,
    ).run(now - 7200, now - 600);

    const res = await app.inject({
      method: 'GET',
      url: `/api/domains/a.test/logs?period=custom&from=${now - 3600}&to=${now}`,
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/new');
  });

  it('period=custom + 잘못된 from/to 는 400', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?period=custom' });
    expect(res.statusCode).toBe(400);
  });

  it('q= 검색어로 path 필터링', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/images/logo.png', 200, 'HIT', 500),
              (?, 'a.test', 'GET', '/api/data', 200, 'MISS', 100)`,
    ).run(now - 10, now - 5);

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?q=images' });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/images/logo.png');
  });
});
