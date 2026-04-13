/// /api/optimizer 라우트 유닛 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { optimizerRoutes } from './optimizer.js';

const mockOptimizerClient = {
  getProfiles: vi.fn(),
  setProfile:  vi.fn(),
  getStats:    vi.fn(),
};

async function createApp() {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('optimizerClient', mockOptimizerClient as any);
  await app.register(optimizerRoutes);
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
