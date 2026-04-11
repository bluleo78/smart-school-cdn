/// 캐시 라우트 유닛 테스트
/// axios를 모킹하여 Cache 관리 API 호출 결과에 따른 응답을 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { cacheRoutes } from './cache.js';

// axios 모듈 전체를 모킹 — Proxy 관리 API 호출을 시뮬레이션
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import axios from 'axios';
const mockAxiosGet = vi.mocked(axios.get);
const mockAxiosDelete = vi.mocked(axios.delete);

/** 테스트용 Fastify 앱 생성 */
async function createApp() {
  const app = Fastify();
  await app.register(cacheRoutes);
  return app;
}

describe('캐시 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/cache/stats ─────────────────────────

  describe('GET /api/cache/stats', () => {
    it('프록시 정상 응답 시 통계 data를 그대로 반환한다', async () => {
      // Proxy가 캐시 통계를 정상 반환하는 상황
      const statsData = {
        hit_count: 100,
        miss_count: 20,
        bypass_count: 5,
        hit_rate: 0.8,
        total_size_bytes: 1024,
        max_size_bytes: 10240,
        entry_count: 50,
        by_domain: [],
        hit_rate_history: [],
      };
      mockAxiosGet.mockResolvedValueOnce({ data: statsData });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(statsData);
    });

    it('프록시 연결 실패 시 기본값(빈 통계)을 반환한다', async () => {
      // Proxy 관리 API 연결 실패 상황 — 서버가 내려간 경우
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/stats' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        hit_count: 0,
        miss_count: 0,
        bypass_count: 0,
        hit_rate: 0,
        total_size_bytes: 0,
        max_size_bytes: 0,
        entry_count: 0,
        by_domain: [],
        hit_rate_history: [],
      });
    });

    it('올바른 URL로 Proxy 관리 API를 호출한다', async () => {
      // axios.get이 정해진 엔드포인트로 호출되는지 확인
      mockAxiosGet.mockResolvedValueOnce({ data: {} });

      const app = await createApp();
      await app.inject({ method: 'GET', url: '/api/cache/stats' });

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'http://localhost:8081/cache/stats',
        { timeout: 3000 },
      );
    });
  });

  // ─── GET /api/cache/popular ───────────────────────

  describe('GET /api/cache/popular', () => {
    it('정상 응답 시 인기 콘텐츠 목록을 반환한다', async () => {
      // Proxy가 인기 콘텐츠 배열을 정상 반환하는 상황
      const popularData = [
        { url: 'https://example.com/video.mp4', hit_count: 200 },
        { url: 'https://example.com/image.png', hit_count: 150 },
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: popularData });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(popularData);
    });

    it('프록시 연결 실패 시 빈 배열을 반환한다', async () => {
      // Proxy 관리 API 연결 실패 상황
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/cache/popular' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ─── DELETE /api/cache/purge ──────────────────────

  describe('DELETE /api/cache/purge', () => {
    it('type이 없으면 400을 반환한다', async () => {
      // 필수 필드 누락 시 유효성 검사로 거부
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(mockAxiosDelete).not.toHaveBeenCalled();
    });

    it('type이 url이고 target이 없으면 400을 반환한다', async () => {
      // url 타입은 대상 URL 없이 퍼지할 수 없음
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'url' },
      });

      expect(res.statusCode).toBe(400);
      expect(mockAxiosDelete).not.toHaveBeenCalled();
    });

    it('type이 domain이고 target이 없으면 400을 반환한다', async () => {
      // domain 타입은 대상 도메인 없이 퍼지할 수 없음
      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'domain' },
      });

      expect(res.statusCode).toBe(400);
      expect(mockAxiosDelete).not.toHaveBeenCalled();
    });

    it('url 타입 + target 있으면 axios.delete 호출 후 data를 반환한다', async () => {
      // 특정 URL 캐시 퍼지 성공 시나리오
      const purgeResult = { purged: 1 };
      mockAxiosDelete.mockResolvedValueOnce({ data: purgeResult });

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'url', target: 'https://example.com/video.mp4' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(purgeResult);
      expect(mockAxiosDelete).toHaveBeenCalledWith(
        'http://localhost:8081/cache/purge',
        { data: { type: 'url', target: 'https://example.com/video.mp4' }, timeout: 3000 },
      );
    });

    it('all 타입은 target 없이도 성공한다', async () => {
      // 전체 캐시 퍼지 — target 불필요
      const purgeResult = { purged: 100 };
      mockAxiosDelete.mockResolvedValueOnce({ data: purgeResult });

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'all' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(purgeResult);
    });

    it('Proxy 서버 에러 시 502를 반환한다', async () => {
      // Proxy 관리 API 연결 실패 — 게이트웨이 오류로 응답
      mockAxiosDelete.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/cache/purge',
        headers: { 'content-type': 'application/json' },
        payload: { type: 'all' },
      });

      expect(res.statusCode).toBe(502);
    });
  });
});
