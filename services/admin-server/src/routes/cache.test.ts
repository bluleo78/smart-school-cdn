/// 캐시 라우트 유닛 테스트
/// storageClient Fastify 데코레이터를 모킹하여 gRPC 기반 캐시 API를 검증한다.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { cacheRoutes } from './cache.js';

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

/** domains 테이블 스키마 — URL 퍼지 도메인 검증에 필요 */
const DOMAINS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS domains (
    host        TEXT PRIMARY KEY,
    origin      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`;

/** storage Stats 응답 형태 — domain_stats 포함 (entry_count 합산 검증용 #195) */
type StatsImpl = () => Promise<{
  used_bytes: number;
  total_bytes: number;
  domain_stats?: Array<{ domain: string; size_bytes: number; file_count: number; hit_rate: number }>;
}>;

/** storageClient 전체 mock — stats/popular/purge* 포함 */
function makeStorageMock(statsImpl: StatsImpl) {
  return {
    stats:       statsImpl,
    popular:     vi.fn<() => Promise<{ entries: unknown[] }>>(),
    purgeUrl:    vi.fn<(u: string) => Promise<unknown>>(),
    purgeDomain: vi.fn<(d: string) => Promise<unknown>>(),
    purgeAll:    vi.fn<() => Promise<unknown>>(),
    health:      vi.fn<() => Promise<unknown>>(),
  };
}

/**
 * 테스트용 Fastify 앱 생성 — in-memory SQLite + storageClient mock 주입
 * @param opts.storage - storageClient mock (makeStorageMock으로 생성)
 * @param opts.domains - 등록된 도메인 목록 (URL 퍼지 검증 테스트용, 기본값: 빈 배열)
 */
function mkApp(opts: {
  storage: ReturnType<typeof makeStorageMock>;
  domains?: string[];
}) {
  const db = new Database(':memory:');
  db.exec(DOMAIN_STATS_SCHEMA);
  db.exec(DOMAINS_SCHEMA);
  // 도메인 목록이 주어지면 테스트용으로 미리 등록해 둔다
  if (opts.domains) {
    const stmt = db.prepare('INSERT INTO domains (host, origin) VALUES (?, ?)');
    for (const host of opts.domains) {
      stmt.run(host, `https://${host}`);
    }
  }

  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('db', db as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('storageClient', opts.storage as any);

  // 등록은 동기로 처리하기 위해 ready() 전에 register 호출 — inject()가 자동으로 ready를 트리거
  app.register(cacheRoutes);

  return { app, db };
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// ─── GET /api/cache/stats (재설계) ───────────────────────────────────────────

describe('GET /api/cache/stats (재설계)', () => {
  it('빈 DB일 때 모든 비율이 0이고 disk는 storage 값', async () => {
    const { app } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      requests: 0, l1_hits: 0, l2_hits: 0, miss: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0, edge_hit_rate: 0, bypass_rate: 0,
      disk: { used_bytes: 0, max_bytes: 0, entry_count: 0 },
      by_domain: [],
    });
  });

  it('샘플 데이터에서 비율 정확히 계산 + by_domain 포함', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({
        used_bytes: 1000,
        total_bytes: 10000,
        // #195: domain_stats[].file_count 합산이 disk.entry_count로 노출되는지 검증 (12 + 7 = 19)
        domain_stats: [
          { domain: 'a.test', size_bytes: 600, file_count: 12, hit_rate: 0.6 },
          { domain: 'b.test', size_bytes: 400, file_count: 7,  hit_rate: 0.4 },
        ],
      })),
    });
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (
      'a.test', ?, 100, 70, 10, 2048, 12,
      60, 10, 15, 5, 0, 0
    )`).run(nowSec() - 100);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.requests).toBe(100);
    expect(body.l1_hits).toBe(60);
    expect(body.l2_hits).toBe(10);
    expect(body.miss).toBe(10);
    expect(body.bypass).toEqual({ method: 15, nocache: 5, size: 0, other: 0, total: 20 });
    expect(body.l1_hit_rate).toBeCloseTo(0.60);
    expect(body.edge_hit_rate).toBeCloseTo(0.70);
    expect(body.bypass_rate).toBeCloseTo(0.20);
    expect(body.disk).toEqual({ used_bytes: 1000, max_bytes: 10000, entry_count: 19 });
    expect(body.by_domain).toHaveLength(1);
    expect(body.by_domain[0]).toMatchObject({
      host: 'a.test', requests: 100, l1_hits: 60, l2_hits: 10, bypass_total: 20,
    });
    expect(body.by_domain[0].l1_hit_rate).toBeCloseTo(0.60);
    expect(body.by_domain[0].edge_hit_rate).toBeCloseTo(0.70);
  });

  it('disk.entry_count는 storage domain_stats[].file_count 합산값 (#195)', async () => {
    // #195: 이전엔 0 하드코딩으로 대시보드 '캐시 항목' 카드가 항상 0이었다.
    // domain_stats가 비어있으면 0, 일부 file_count 누락이면 ?? 0으로 안전하게 합산되어야 한다.
    const { app } = mkApp({
      storage: makeStorageMock(async () => ({
        used_bytes: 2048,
        total_bytes: 4096,
        domain_stats: [
          { domain: 'x.test', size_bytes: 1024, file_count: 3, hit_rate: 0.5 },
          { domain: 'y.test', size_bytes: 1024, file_count: 0, hit_rate: 0 },
          // file_count 필드 누락 케이스 — undefined → 0 폴백 검증
          { domain: 'z.test', size_bytes: 0 } as unknown as {
            domain: string; size_bytes: number; file_count: number; hit_rate: number;
          },
        ],
      })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().disk).toEqual({ used_bytes: 2048, max_bytes: 4096, entry_count: 3 });
  });

  it('disk.entry_count — domain_stats가 빈 배열이면 0 (#195)', async () => {
    const { app } = mkApp({
      storage: makeStorageMock(async () => ({
        used_bytes: 100, total_bytes: 200, domain_stats: [],
      })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(res.json().disk.entry_count).toBe(0);
  });

  it('storage gRPC 실패 시 disk는 0, 나머지는 정상', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => { throw new Error('offline'); }),
    });
    db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (
      'a.test', ?, 10, 7, 3, 0, 0,
      7, 0, 0, 0, 0, 0
    )`).run(nowSec() - 100);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.disk).toEqual({ used_bytes: 0, max_bytes: 0, entry_count: 0 });
    expect(body.l1_hit_rate).toBeCloseTo(0.7);
  });

  it('by_domain이 요청수 내림차순 + LIMIT 20', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const stmt = db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`);
    const ts = nowSec() - 100;
    for (let i = 0; i < 25; i++) {
      stmt.run(`h${i}.test`, ts, (25 - i) * 10);
    }

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.by_domain).toHaveLength(20);
    expect(body.by_domain[0].host).toBe('h0.test');
    expect(body.by_domain[0].requests).toBe(250);
    expect(body.by_domain[19].host).toBe('h19.test');
  });

  it('24시간 이전 데이터는 집계 제외', async () => {
    const { app, db } = mkApp({
      storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })),
    });
    const stmt = db.prepare(`INSERT INTO domain_stats (
      host, timestamp, requests, cache_hits, cache_misses, bandwidth, avg_response_time,
      l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
    ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0)`);
    stmt.run('old', nowSec() - 86400 - 100, 9999, 9999, 9999);
    stmt.run('new', nowSec() - 100, 5, 5, 5);

    const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });
    const body = res.json();
    expect(body.requests).toBe(5);
    expect(body.by_domain.map((d: { host: string }) => d.host)).toEqual(['new']);
  });
});

// ─── GET /api/cache/popular ──────────────────────────────────────────────────

describe('GET /api/cache/popular', () => {
  it('정상 응답 시 인기 콘텐츠 목록을 반환한다', async () => {
    const entries = [
      { url: 'https://example.com/video.mp4', hit_count: 200 },
      { url: 'https://example.com/image.png', hit_count: 150 },
    ];
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.popular.mockResolvedValueOnce({ entries });
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(entries);
  });

  it('storage-service 연결 실패 시 빈 배열을 반환한다', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.popular.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ─── DELETE /api/cache/purge ──────────────────────────────────────────────────

describe('DELETE /api/cache/purge', () => {
  it('type이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('type이 url이고 target이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('type이 domain이고 target이 없으면 400을 반환한다', async () => {
    const { app } = mkApp({ storage: makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 })) });
    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'domain' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('url 타입 + target 있으면 purgeUrl 호출 후 클라이언트 계약(purged_count)으로 정규화해 반환한다 (#182)', async () => {
    // example.com을 등록된 도메인으로 시드해야 검증 통과 후 purgeUrl이 호출된다
    const purgeResult = { purged_files: 1, freed_bytes: 512 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeUrl.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock, domains: ['example.com'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://example.com/video.mp4' },
    });
    expect(res.statusCode).toBe(200);
    // gRPC purged_files → admin-web purged_count 정규화 검증 (#182)
    expect(res.json()).toEqual({ purged_count: 1, freed_bytes: 512 });
    expect(mock.purgeUrl).toHaveBeenCalledWith('https://example.com/video.mp4');
  });

  it('url 타입 + target hostname이 등록되지 않은 도메인이면 400을 반환한다 (#36 크로스 도메인 퍼지 방지)', async () => {
    // domains 테이블에 없는 hostname → 400 거부
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://totally-different-domain.com/secret/path' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('등록된 도메인');
    // purgeUrl은 호출되지 않아야 한다
    expect(mock.purgeUrl).not.toHaveBeenCalled();
  });

  // 와일드카드 도메인 매칭 검증 (#234) — `*.base` 등록 시 base 또는 base.* 서브도메인이 hostname이면 통과
  it('url 타입 + hostname이 등록된 와일드카드 도메인의 하위 도메인이면 purgeUrl을 호출한다 (#234)', async () => {
    const purgeResult = { purged_files: 2, freed_bytes: 1024 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeUrl.mockResolvedValueOnce(purgeResult);
    // *.cdn.edu.kr 와일드카드 등록 → app.cdn.edu.kr 하위 도메인 URL 허용
    const { app } = mkApp({ storage: mock, domains: ['*.cdn.edu.kr'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://app.cdn.edu.kr/foo.png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ purged_count: 2, freed_bytes: 1024 });
    expect(mock.purgeUrl).toHaveBeenCalledWith('https://app.cdn.edu.kr/foo.png');
  });

  it('url 타입 + hostname이 와일드카드 도메인의 베이스(cdn.edu.kr)면 purgeUrl을 호출한다 (#234)', async () => {
    const purgeResult = { purged_files: 1, freed_bytes: 256 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeUrl.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock, domains: ['*.cdn.edu.kr'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://cdn.edu.kr/x' },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.purgeUrl).toHaveBeenCalledWith('https://cdn.edu.kr/x');
  });

  it('url 타입 + hostname이 와일드카드 베이스와 무관하면 400을 반환한다 (#234)', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    const { app } = mkApp({ storage: mock, domains: ['*.cdn.edu.kr'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://other.example.com/x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('등록된 도메인');
    expect(mock.purgeUrl).not.toHaveBeenCalled();
  });

  it('url 타입 + 유효하지 않은 URL이면 400을 반환한다 (#36)', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('유효하지 않은 URL');
    expect(mock.purgeUrl).not.toHaveBeenCalled();
  });

  it('domain 타입 + 등록된 target이면 purgeDomain 호출 후 결과를 반환한다', async () => {
    const purgeResult = { purged_files: 5, freed_bytes: 2048 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeDomain.mockResolvedValueOnce(purgeResult);
    // domain 퍼지도 #168 부수 결함 수정으로 등록 도메인 검증을 거친다
    const { app } = mkApp({ storage: mock, domains: ['example.com'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'domain', target: 'example.com' },
    });
    expect(res.statusCode).toBe(200);
    // gRPC purged_files → admin-web purged_count 정규화 검증 (#182)
    expect(res.json()).toEqual({ purged_count: 5, freed_bytes: 2048 });
    expect(mock.purgeDomain).toHaveBeenCalledWith('example.com');
  });

  it('domain 타입 + 등록되지 않은 target이면 400을 반환한다 (#168 부수 결함)', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'domain', target: 'unknown.example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('등록된 도메인');
    expect(mock.purgeDomain).not.toHaveBeenCalled();
  });

  // #297: type=domain/url의 target host 입력 정규화 — trim + lowercase
  // DNS 호스트 case-insensitive(RFC 1035 §2.3.3) + 공백 입력 방지. #296과 동일 root cause.
  describe('target host 입력 정규화 (#297)', () => {
    it('domain 타입 + 대문자 target이어도 등록된 도메인으로 매칭되어 purgeDomain을 호출한다', async () => {
      const purgeResult = { purged_files: 3, freed_bytes: 1024 };
      const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
      mock.purgeDomain.mockResolvedValueOnce(purgeResult);
      const { app } = mkApp({ storage: mock, domains: ['httpbin.org'] });

      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain', target: 'HTTPBIN.ORG' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ purged_count: 3, freed_bytes: 1024 });
      // 후속 storageClient 호출도 정규화된 값(소문자)으로 일관성 보장
      expect(mock.purgeDomain).toHaveBeenCalledWith('httpbin.org');
    });

    it('domain 타입 + 앞뒤 공백 target이어도 등록된 도메인으로 매칭된다', async () => {
      const purgeResult = { purged_files: 1, freed_bytes: 256 };
      const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
      mock.purgeDomain.mockResolvedValueOnce(purgeResult);
      const { app } = mkApp({ storage: mock, domains: ['httpbin.org'] });

      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain', target: ' httpbin.org ' },
      });
      expect(res.statusCode).toBe(200);
      expect(mock.purgeDomain).toHaveBeenCalledWith('httpbin.org');
    });

    it('domain 타입 + 미등록 target이면 에러 메시지에 정규화된 값을 노출한다', async () => {
      const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
      const { app } = mkApp({ storage: mock });

      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain', target: ' UNKNOWN.example.com ' },
      });
      expect(res.statusCode).toBe(400);
      // trim + lowercase 적용된 값이 메시지에 노출되어야 사용자 혼란이 적다
      expect(res.json().error).toBe('unknown.example.com은(는) 등록된 도메인이 아닙니다.');
    });

    it('url 타입 + 대문자 hostname이어도 등록된 와일드카드 도메인으로 매칭된다', async () => {
      const purgeResult = { purged_files: 2, freed_bytes: 512 };
      const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
      mock.purgeUrl.mockResolvedValueOnce(purgeResult);
      const { app } = mkApp({ storage: mock, domains: ['*.cdn.edu.kr'] });

      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'url', target: 'https://APP.CDN.EDU.KR/foo.png' },
      });
      expect(res.statusCode).toBe(200);
      expect(mock.purgeUrl).toHaveBeenCalled();
    });
  });

  it('all 타입은 target 없이도 purgeAll 호출 후 성공한다', async () => {
    const purgeResult = { purged_files: 100, freed_bytes: 1048576 };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeAll.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'all' },
    });
    expect(res.statusCode).toBe(200);
    // gRPC purged_files → admin-web purged_count 정규화 검증 (#182)
    expect(res.json()).toEqual({ purged_count: 100, freed_bytes: 1048576 });
    expect(mock.purgeAll).toHaveBeenCalled();
  });

  // #208 회귀: gRPC uint64 필드는 @grpc/grpc-js가 string으로 역직렬화 → admin-web의 number 비교가
  // 깨져 "0건 삭제" 성공 토스트가 노출되던 문제. boundary에서 Number 변환 보장.
  it('gRPC가 uint64를 string으로 반환해도 number로 정규화한다 (#208 회귀)', async () => {
    // @grpc/grpc-js 기본 동작: uint64 → string (정밀도 보존). 여기선 "0", "0" 시뮬레이션.
    const purgeResult = { purged_files: '0' as unknown as number, freed_bytes: '0' as unknown as number };
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeUrl.mockResolvedValueOnce(purgeResult);
    const { app } = mkApp({ storage: mock, domains: ['example.com'] });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'url', target: 'https://example.com/never-cached' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // string "0"이 아니라 number 0으로 와야 admin-web의 === 0 분기가 동작한다
    expect(body).toEqual({ purged_count: 0, freed_bytes: 0 });
    expect(typeof body.purged_count).toBe('number');
    expect(typeof body.freed_bytes).toBe('number');
  });

  // #168: 화이트리스트 외 type 값은 모두 400 (purgeAll 폴백 차단)
  it.each(['NUKE', 'urls', 'bogus', 'domain_typo', ''])(
    'type이 화이트리스트 외 문자열("%s")이면 400을 반환하고 purgeAll을 호출하지 않는다 (#168)',
    async (badType) => {
      const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
      const { app } = mkApp({ storage: mock });

      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: badType },
      });
      expect(res.statusCode).toBe(400);
      expect(mock.purgeAll).not.toHaveBeenCalled();
      expect(mock.purgeUrl).not.toHaveBeenCalled();
      expect(mock.purgeDomain).not.toHaveBeenCalled();
    },
  );

  it('type이 boolean true 같은 truthy 값이어도 400을 반환한다 (#168)', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: true },
    });
    expect(res.statusCode).toBe(400);
    expect(mock.purgeAll).not.toHaveBeenCalled();
  });

  it('storage-service 에러 시 502를 반환한다', async () => {
    const mock = makeStorageMock(async () => ({ used_bytes: 0, total_bytes: 0 }));
    mock.purgeAll.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    const { app } = mkApp({ storage: mock });

    const res = await app.inject({
      method: 'DELETE', url: '/api/cache/purge',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'all' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'storage-service에 연결할 수 없습니다.' });
  });
});
