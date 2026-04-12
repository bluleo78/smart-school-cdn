/// 캐시 라우트 유닛 테스트
/// storageClient Fastify 데코레이터를 모킹하여 gRPC 기반 캐시 API를 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { cacheRoutes } from './cache.js';

/** 테스트용 storageClient mock */
const mockStorageClient = {
  stats:       vi.fn(),
  popular:     vi.fn(),
  purgeUrl:    vi.fn(),
  purgeDomain: vi.fn(),
  purgeAll:    vi.fn(),
  health:      vi.fn(),
};

/** 테스트용 Fastify 앱 생성 — storageClient 데코레이터 주입 */
async function createApp() {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('storageClient', mockStorageClient as any);
  await app.register(cacheRoutes);
  return app;
}

describe('캐시 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/cache/stats ─────────────────────────

  describe('GET /api/cache/stats', () => {
    it('storage-service 정상 응답 시 통계 data를 그대로 반환한다', async () => {
      const statsData = {
        hit_count: 100, miss_count: 20, bypass_count: 5,
        hit_rate: 0.8, total_size_bytes: 1024, max_size_bytes: 10240,
        entry_count: 50, by_domain: [], hit_rate_history: [],
      };
      mockStorageClient.stats.mockResolvedValueOnce(statsData);

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(statsData);
    });

    it('storage-service 연결 실패 시 기본값(빈 통계)을 반환한다', async () => {
      mockStorageClient.stats.mockRejectedValueOnce(new Error('UNAVAILABLE'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        hit_count: 0, miss_count: 0, bypass_count: 0,
        hit_rate: 0, total_size_bytes: 0, max_size_bytes: 0,
        entry_count: 0, by_domain: [], hit_rate_history: [],
      });
    });
  });

  // ─── GET /api/cache/popular ───────────────────────

  describe('GET /api/cache/popular', () => {
    it('정상 응답 시 인기 콘텐츠 목록을 반환한다', async () => {
      const entries = [
        { url: 'https://example.com/video.mp4', hit_count: 200 },
        { url: 'https://example.com/image.png', hit_count: 150 },
      ];
      mockStorageClient.popular.mockResolvedValueOnce({ entries });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(entries);
    });

    it('storage-service 연결 실패 시 빈 배열을 반환한다', async () => {
      mockStorageClient.popular.mockRejectedValueOnce(new Error('UNAVAILABLE'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ─── DELETE /api/cache/purge ──────────────────────

  describe('DELETE /api/cache/purge', () => {
    it('type이 없으면 400을 반환한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(mockStorageClient.purgeUrl).not.toHaveBeenCalled();
    });

    it('type이 url이고 target이 없으면 400을 반환한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'url' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('type이 domain이고 target이 없으면 400을 반환한다', async () => {
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('url 타입 + target 있으면 purgeUrl 호출 후 결과를 반환한다', async () => {
      const purgeResult = { purged_files: 1, freed_bytes: 512 };
      mockStorageClient.purgeUrl.mockResolvedValueOnce(purgeResult);

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'url', target: 'https://example.com/video.mp4' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(purgeResult);
      expect(mockStorageClient.purgeUrl).toHaveBeenCalledWith('https://example.com/video.mp4');
    });

    it('domain 타입 + target 있으면 purgeDomain 호출 후 결과를 반환한다', async () => {
      const purgeResult = { purged_files: 5, freed_bytes: 2048 };
      mockStorageClient.purgeDomain.mockResolvedValueOnce(purgeResult);

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain', target: 'example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(purgeResult);
      expect(mockStorageClient.purgeDomain).toHaveBeenCalledWith('example.com');
    });

    it('all 타입은 target 없이도 purgeAll 호출 후 성공한다', async () => {
      const purgeResult = { purged_files: 100, freed_bytes: 1048576 };
      mockStorageClient.purgeAll.mockResolvedValueOnce(purgeResult);

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'all' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(purgeResult);
      expect(mockStorageClient.purgeAll).toHaveBeenCalled();
    });

    it('storage-service 에러 시 502를 반환한다', async () => {
      mockStorageClient.purgeAll.mockRejectedValueOnce(new Error('UNAVAILABLE'));

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE', url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'all' },
      });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'storage-service에 연결할 수 없습니다.' });
    });
  });
});
