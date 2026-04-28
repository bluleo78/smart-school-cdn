import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { DomainRepository, DOMAIN_SCHEMA } from '../db/domain-repo.js';
import { DomainStatsRepository } from '../db/domain-stats-repo.js';
import { OptimizationEventsRepository, OPTIMIZATION_EVENTS_SCHEMA } from '../db/optimization-events-repo.js';
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

/** tls-service / dns-service gRPC 팬아웃 mock — listCertificates는 기본적으로 빈 목록 반환 */
const mockTlsClient = {
  syncDomains: vi.fn().mockResolvedValue({ success: true }),
  listCertificates: vi.fn().mockResolvedValue({ certs: [] }),
};
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
  // optimization_events 스키마 — Phase 16-3 url-breakdown API 테스트용
  db.exec(OPTIMIZATION_EVENTS_SCHEMA);
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

  it('XSS 페이로드 host는 400을 반환한다 (#37)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: '<script>alert(1)</script>.evil.com', origin: 'https://origin.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('유효한 도메인 형식이 아닙니다');
  });

  it('특수문자가 포함된 host는 400을 반환한다 (#37)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: 'in valid!domain', origin: 'https://origin.test' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('유효한 도메인 형식이 아닙니다');
  });

  it('와일드카드 도메인(*.sub.com)은 201을 반환한다 (#37)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      payload: { host: '*.textbook.com', origin: 'https://textbook.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).host).toBe('*.textbook.com');
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

  /** origin scheme 검증 — PUT과 동일한 이중 방어 패턴 (#42) */
  it('javascript: scheme origin은 400을 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
  });

  it('ftp:// scheme origin은 400을 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'ftp://textbook.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
  });

  it('scheme 없는 origin(textbook.com)은 400을 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains',
      payload: { host: 'textbook.com', origin: 'textbook.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
  });
});

describe('POST /api/domains/bulk', () => {
  it('유효한 도메인 목록을 일괄 추가하면 201을 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains/bulk',
      payload: { domains: [{ host: 'textbook.com', origin: 'https://textbook.com' }] },
    });
    expect(res.statusCode).toBe(201);
  });

  it('domains 배열이 없으면 400을 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains/bulk',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('필수');
  });

  /** origin scheme 검증 — javascript: 등 비정상 scheme 차단 (#42) */
  it('javascript: scheme origin을 포함한 bulk 요청은 400을 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains/bulk',
      payload: { domains: [{ host: 'textbook.com', origin: 'javascript:alert(1)' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
  });

  it('ftp:// scheme origin을 포함한 bulk 요청은 400을 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains/bulk',
      payload: { domains: [{ host: 'a.com', origin: 'ftp://a.com' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
  });

  it('혼합 목록에서 하나라도 비정상 scheme이 있으면 전체 400 반환한다 (#42)', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'POST', url: '/api/domains/bulk',
      payload: {
        domains: [
          { host: 'good.com', origin: 'https://good.com' },
          { host: 'bad.com', origin: 'file:///etc/passwd' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('http:// 또는 https://');
    // 정상 도메인도 저장되지 않아야 한다 (검증 실패 시 전체 요청을 거부)
    expect(repo.findByHost('good.com')).toBeUndefined();
  });
});

describe('PUT /api/domains/:host', () => {
  it('origin을 정상 값으로 업데이트하면 200 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/httpbin.org',
      payload: { origin: 'https://new-origin.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).origin).toBe('https://new-origin.com');
  });

  it('origin이 빈 문자열이면 400 반환한다 (#59)', async () => {
    // POST /api/domains는 !origin 검사가 있지만 PUT에는 없어 빈 origin이 저장되던 버그 수정
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/httpbin.org',
      payload: { origin: '' },
    });
    expect(res.statusCode).toBe(400);
    // 원래 origin이 그대로 유지되어야 한다
    expect(repo.findByHost('httpbin.org')?.origin).toBe('https://httpbin.org');
  });

  it('origin이 공백만 있는 문자열이면 400 반환한다 (#59)', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/httpbin.org',
      payload: { origin: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('origin 없이 enabled만 보내면 200 반환한다 (origin은 변경 안 됨)', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/httpbin.org',
      payload: { enabled: 0 },
    });
    expect(res.statusCode).toBe(200);
    // origin은 그대로 유지된다
    expect(repo.findByHost('httpbin.org')?.origin).toBe('https://httpbin.org');
  });

  it('없는 도메인 PUT 시 404 반환한다', async () => {
    const repo = makeRepo();
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/notexist.com',
      payload: { origin: 'https://new.com' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('syncToProxy 실패 시 502를 반환하고 DB를 원래 값으로 롤백한다 (#151)', async () => {
    // Proxy 동기화 실패 시 DB 변경이 원복되어 toggle과 동일한 일관성을 보장한다
    const axiosMod = await import('axios');
    vi.mocked(axiosMod.default.post).mockRejectedValueOnce(new Error('Network error'));

    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    const app = buildApp(repo);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/domains/httpbin.org',
      payload: { origin: 'https://new-origin.com' },
    });

    expect(res.statusCode).toBe(502);
    // DB가 원래 origin으로 롤백되었는지 확인
    expect(repo.findByHost('httpbin.org')?.origin).toBe('https://httpbin.org');
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

  it('syncToProxy 실패 시 502를 반환하고 삭제된 도메인을 DB에 복원한다 (#151)', async () => {
    // Proxy 동기화 실패 시 DB에서 삭제한 도메인을 원복하여 toggle·PUT과 동일한 일관성을 보장한다
    const axiosMod = await import('axios');
    vi.mocked(axiosMod.default.post).mockRejectedValueOnce(new Error('Network error'));

    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    // 비활성 상태로 변경하여 enabled 복원도 검증한다
    repo.update('httpbin.org', { enabled: 0 });
    const app = buildApp(repo);
    const res = await app.inject({ method: 'DELETE', url: '/api/domains/httpbin.org' });

    expect(res.statusCode).toBe(502);
    // DB에 도메인이 복원되었는지 확인
    const restored = repo.findByHost('httpbin.org');
    expect(restored).toBeDefined();
    expect(restored?.origin).toBe('https://httpbin.org');
    expect(restored?.enabled).toBe(0);
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

describe('GET /api/domains/summary — TLS 만료 임박 alerts', () => {
  it('30일 이내 만료 예정 인증서가 있으면 tls_expiring alert를 반환한다', async () => {
    const repo = makeRepo();
    repo.upsert('httpbin.org', 'https://httpbin.org');
    // 29일 후 만료 — 30일 임계값 내
    const soonMs = Date.now() + 29 * 86_400_000;
    const expiresAt = new Date(soonMs).toISOString();
    mockTlsClient.listCertificates.mockResolvedValueOnce({
      certs: [{ domain: 'httpbin.org', issued_at: '2025-01-01T00:00:00Z', expires_at: expiresAt, status: 'active' }],
    });
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe('tls_expiring');
    expect(body.alerts[0].host).toBe('httpbin.org');
    expect(body.alerts[0].expiresAt).toBe(expiresAt);
  });

  it('30일 초과 만료 인증서와 이미 만료된 인증서는 alerts에 포함하지 않는다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const farFuture = new Date(Date.now() + 60 * 86_400_000).toISOString(); // 60일 후
    const alreadyExpired = new Date(Date.now() - 86_400_000).toISOString(); // 어제
    mockTlsClient.listCertificates.mockResolvedValueOnce({
      certs: [
        { domain: 'a.test',  issued_at: '2025-01-01T00:00:00Z', expires_at: farFuture,     status: 'active' },
        { domain: 'b.test',  issued_at: '2025-01-01T00:00:00Z', expires_at: alreadyExpired, status: 'expired' },
      ],
    });
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/summary' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).alerts).toHaveLength(0);
  });

  it('tls-service listCertificates 실패 시에도 summary는 200이고 alerts는 빈 배열이다', async () => {
    const repo = makeRepo();
    mockTlsClient.listCertificates.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/summary' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).alerts).toEqual([]);
  });
});

describe('GET /api/domains/:host/top-urls', () => {
  it('GET /api/domains/:host/top-urls — 기간 내 상위 5 URL 반환', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    const stmt = repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', ?, 200, 'HIT', 100)`
    );
    // /a x3, /b x2, /c x1 (전부 최근 1시간 내)
    ['/a','/a','/a','/b','/b','/c'].forEach((p) => stmt.run(now - 300, p));

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/top-urls?period=1h&limit=3' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { urls: Array<{ path: string; count: number }> };
    expect(body.urls).toEqual([
      { path: '/a', count: 3 },
      { path: '/b', count: 2 },
      { path: '/c', count: 1 },
    ]);
  });

  it('GET /api/domains/:host/top-urls — custom + 잘못된 from/to 는 400', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/top-urls?period=custom&from=1&to=1' });
    expect(res.statusCode).toBe(400);
  });

  // 회귀 테스트: 와일드카드 도메인(*.example.com)은 프론트엔드에서 encodeURIComponent로
  // 인코딩되어 전달되므로 핸들러가 decodeURIComponent로 디코딩해야 DB 조회가 정상 동작함.
  // 수정 전에는 '%2A.textbook.com'으로 DB를 검색해 항상 0건 반환하는 버그 있었음 (#115).
  it('GET /api/domains/:host/top-urls — 와일드카드 도메인 인코딩(%2A) 디코딩 후 정상 조회', async () => {
    const repo = makeRepo();
    repo.upsert('*.textbook.com', 'https://textbook.com');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, '*.textbook.com', 'GET', '/book.pdf', 200, 'HIT', 500)`
    ).run(now - 300);

    // encodeURIComponent('*.textbook.com') === '%2A.textbook.com'
    const encoded = encodeURIComponent('*.textbook.com');
    const res = await app.inject({ method: 'GET', url: `/api/domains/${encoded}/top-urls?period=1h` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { urls: Array<{ path: string; count: number }> };
    expect(body.urls).toHaveLength(1);
    expect(body.urls[0]).toEqual({ path: '/book.pdf', count: 1 });
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

  it('음수 offset은 0으로 클램프된다 — SQLite OFFSET 음수 방어 (#149)', async () => {
    // offset=-1 전달 시 500 에러가 아닌 정상 응답(offset=0 동작)을 반환해야 한다
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/page', 200, 'HIT', 100)`,
    ).run(now - 10);

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?offset=-1' });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    // offset=0 과 동일하게 동작 — 행이 반환되어야 함
    expect(rows).toHaveLength(1);
  });

  it('음수 limit은 기본값 100으로 폴백된다 (#149)', async () => {
    // limit=-5 전달 시 기본값(100)으로 동작해야 한다
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/page', 200, 'HIT', 100)`,
    ).run(now - 10);

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?limit=-5' });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows).toHaveLength(1);
  });

  it('limit=0은 기본값 100으로 폴백된다 (#149)', async () => {
    // limit=0 전달 시도 기본값(100)으로 동작해야 한다
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a.test');
    const app = buildApp(repo);
    const now = Math.floor(Date.now() / 1000);
    repo.database.prepare(
      `INSERT INTO access_logs (timestamp, host, method, path, status_code, cache_status, size)
       VALUES (?, 'a.test', 'GET', '/page', 200, 'HIT', 100)`,
    ).run(now - 10);

    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/logs?limit=0' });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/domains/:host/optimization/url-breakdown', () => {
  // Phase 16-3: optimization_events를 URL 기준 GROUP BY 후 정렬·필터·페이지네이션
  it('URL별로 집계하고 savings 기준 정렬한다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a');
    const evRepo = new OptimizationEventsRepository(repo.database);
    // proxy/optimizer-service가 실제 DB에 저장하는 값은 snake_case 소문자다.
    // PascalCase로 쓰면 필터가 통과되지 않아 회귀로 이어진다.
    evRepo.insert({ event_type: 'image_optimize', host: 'a.test', url: 'https://a.test/big.png',
      decision: 'optimized', orig_size: 1000, out_size: 200, elapsed_ms: 10 });
    evRepo.insert({ event_type: 'text_compress', host: 'a.test', url: 'https://a.test/app.js',
      decision: 'compressed_br', orig_size: 1000, out_size: 800, elapsed_ms: 5 });

    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/optimization/url-breakdown?sort=savings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: Array<{ url: string; savings_ratio: number }> };
    expect(body.total).toBe(2);
    expect(body.items[0].url).toBe('https://a.test/big.png');
    expect(body.items[0].savings_ratio).toBeCloseTo(0.8, 2);
  });

  it('decision 필터와 q 검색이 동작한다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a');
    const evRepo = new OptimizationEventsRepository(repo.database);
    evRepo.insert({ event_type: 'image_optimize', host: 'a.test', url: 'https://a.test/a.png',
      decision: 'optimized', orig_size: 1000, out_size: 200, elapsed_ms: 10 });
    evRepo.insert({ event_type: 'image_optimize', host: 'a.test', url: 'https://a.test/b.gif',
      decision: 'passthrough_larger', orig_size: 500, out_size: 500, elapsed_ms: 5 });

    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET',
      url: '/api/domains/a.test/optimization/url-breakdown?decision=optimized&q=a.png' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number };
    expect(body.total).toBe(1);
  });

  it('와일드카드 호스트(URL 인코딩)도 매칭한다', async () => {
    const repo = makeRepo();
    repo.upsert('*.textbook.com', 'https://origin');
    const evRepo = new OptimizationEventsRepository(repo.database);
    evRepo.insert({ event_type: 'image_optimize', host: '*.textbook.com',
      url: 'https://x.textbook.com/a.png',
      decision: 'optimized', orig_size: 1000, out_size: 200, elapsed_ms: 10 });

    const app = buildApp(repo);
    const encoded = encodeURIComponent('*.textbook.com');
    const res = await app.inject({ method: 'GET',
      url: `/api/domains/${encoded}/optimization/url-breakdown` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { total: number }).total).toBe(1);
  });

  // out_size NULL 이벤트(skipped_small 등)는 "압축/변환 안 함"을 의미한다.
  // total_out을 NULL→0으로 집계하면 절감 100%로 과대 표기되므로 원본 크기로 대체한다.
  it('out_size NULL(skipped_small) 이벤트는 원본 크기로 집계돼 savings 0%이 된다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a');
    const evRepo = new OptimizationEventsRepository(repo.database);
    evRepo.insert({ event_type: 'text_compress', host: 'a.test', url: 'https://a.test/tiny.html',
      decision: 'skipped_small', orig_size: 317, out_size: null, elapsed_ms: 0 });

    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET', url: '/api/domains/a.test/optimization/url-breakdown' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ total_orig: number; total_out: number; savings_ratio: number }> };
    expect(body.items[0].total_orig).toBe(317);
    expect(body.items[0].total_out).toBe(317);
    expect(body.items[0].savings_ratio).toBe(0);
  });

  it('limit이 숫자가 아니면 무시한다', async () => {
    const repo = makeRepo();
    repo.upsert('a.test', 'https://a');
    const app = buildApp(repo);
    const res = await app.inject({ method: 'GET',
      url: '/api/domains/a.test/optimization/url-breakdown?limit=abc' });
    expect(res.statusCode).toBe(200); // NaN을 우아하게 무시
  });
});
