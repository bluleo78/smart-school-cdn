/// /api/optimizer 라우트 유닛 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { optimizerRoutes } from './optimizer.js';

const mockOptimizerClient = {
  getProfiles: vi.fn(),
  setProfile:  vi.fn(),
  getStats:    vi.fn(),
};

/**
 * 테스트용 stub domainRepo — `findByHost`만 사용한다.
 * 등록된 host 집합을 받아 해당 host에는 객체를, 그 외에는 undefined를 반환.
 */
function makeDomainRepo(registered: string[] = ['example.com']) {
  return {
    findByHost: (host: string) =>
      registered.includes(host) ? ({ host } as { host: string }) : undefined,
  };
}

interface CreateAppOptions {
  withDomainRepo?: boolean;
  registered?: string[];
}

async function createApp(opts: CreateAppOptions = { withDomainRepo: true }) {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('optimizerClient', mockOptimizerClient as any);
  if (opts.withDomainRepo === false) {
    await app.register(optimizerRoutes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await app.register(optimizerRoutes, { domainRepo: makeDomainRepo(opts.registered) as any });
  }
  return app;
}

describe('GET /api/optimizer/profiles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('프로파일 목록을 반환한다', async () => {
    mockOptimizerClient.getProfiles.mockResolvedValue({
      profiles: [{ domain: 'example.com', quality: 85, max_width: 0, enabled: true }],
    });
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/optimizer/profiles' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].domain).toBe('example.com');
  });

  it('gRPC 실패 시 빈 목록을 반환한다', async () => {
    mockOptimizerClient.getProfiles.mockRejectedValue(new Error('UNAVAILABLE'));
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/optimizer/profiles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().profiles).toEqual([]);
  });
});

describe('PUT /api/optimizer/profiles/:domain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('프로파일을 저장하고 204를 반환한다', async () => {
    mockOptimizerClient.setProfile.mockResolvedValue({});
    const app = await createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/optimizer/profiles/example.com',
      payload: { quality: 75, max_width: 1280, enabled: true },
    });
    expect(res.statusCode).toBe(204);
    expect(mockOptimizerClient.setProfile).toHaveBeenCalledWith({
      domain: 'example.com', quality: 75, max_width: 1280, enabled: true,
    });
  });

  it('gRPC 실패 시 500을 반환한다', async () => {
    mockOptimizerClient.setProfile.mockRejectedValue(new Error('UNAVAILABLE'));
    const app = await createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/optimizer/profiles/example.com',
      payload: { quality: 85, max_width: 0, enabled: true },
    });
    expect(res.statusCode).toBe(500);
  });

  it('quality가 범위를 벗어나면 400을 반환한다', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/optimizer/profiles/example.com',
      payload: { quality: 150, max_width: 0, enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('필수 필드가 누락되면 400을 반환한다', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/optimizer/profiles/example.com',
      payload: { quality: 75, max_width: 1280 },
    });
    expect(res.statusCode).toBe(400);
  });

  /** (#309) :domain 정규화·형식 검증·멤버십 검증 */
  describe(':domain 검증 (#309)', () => {
    it('대소문자/공백을 정규화하여 setProfile에 lowercase로 전달한다', async () => {
      mockOptimizerClient.setProfile.mockResolvedValue({});
      const app = await createApp({ registered: ['example.com'] });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/optimizer/profiles/EXAMPLE.COM',
        payload: { quality: 75, max_width: 1280, enabled: true },
      });
      expect(res.statusCode).toBe(204);
      expect(mockOptimizerClient.setProfile).toHaveBeenCalledWith({
        domain: 'example.com', quality: 75, max_width: 1280, enabled: true,
      });
    });

    it('traversal 시퀀스(../evil)는 400으로 거부한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/optimizer/profiles/..%2Fevil',
        payload: { quality: 80, max_width: 1024, enabled: true },
      });
      expect(res.statusCode).toBe(400);
      expect(mockOptimizerClient.setProfile).not.toHaveBeenCalled();
    });

    it('공백만 있는 키는 400으로 거부한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/optimizer/profiles/%20',
        payload: { quality: 80, max_width: 1024, enabled: true },
      });
      expect(res.statusCode).toBe(400);
      expect(mockOptimizerClient.setProfile).not.toHaveBeenCalled();
    });

    it('메타문자가 포함된 키(<script>...)는 400으로 거부한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/optimizer/profiles/${encodeURIComponent('<script>alert(1)</script>')}`,
        payload: { quality: 80, max_width: 1024, enabled: true },
      });
      expect(res.statusCode).toBe(400);
      expect(mockOptimizerClient.setProfile).not.toHaveBeenCalled();
    });

    it('미등록 도메인은 404로 거부한다', async () => {
      const app = await createApp({ registered: ['example.com'] });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/optimizer/profiles/nonexistent-explorer-test.invalid',
        payload: { quality: 80, max_width: 1024, enabled: true },
      });
      expect(res.statusCode).toBe(404);
      expect(mockOptimizerClient.setProfile).not.toHaveBeenCalled();
    });

    it('domainRepo 미주입 시(레거시) 형식 검증은 유지하지만 멤버십은 건너뛴다', async () => {
      mockOptimizerClient.setProfile.mockResolvedValue({});
      const app = await createApp({ withDomainRepo: false });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/optimizer/profiles/any-host.example',
        payload: { quality: 80, max_width: 1024, enabled: true },
      });
      expect(res.statusCode).toBe(204);
    });
  });
});

describe('GET /api/stats/optimization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('절감 통계를 반환한다', async () => {
    mockOptimizerClient.getStats.mockResolvedValue({
      stats: [{ domain: 'example.com', original_bytes: 1000, optimized_bytes: 600, count: 5 }],
    });
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats/optimization' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats[0].domain).toBe('example.com');
    expect(body.stats[0].count).toBe(5);
  });

  it('gRPC 실패 시 빈 통계를 반환한다', async () => {
    mockOptimizerClient.getStats.mockRejectedValue(new Error('UNAVAILABLE'));
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats/optimization' });
    expect(res.statusCode).toBe(200);
    expect(res.json().stats).toEqual([]);
  });
});
