/// TLS 라우트 유닛 테스트
/// axios를 모킹하여 TLS 관리 API 호출 결과에 따른 응답을 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { tlsRoutes } from './tls.js';

// axios 모듈 전체를 모킹 — Proxy 관리 API 호출을 시뮬레이션
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from 'axios';
const mockAxiosGet = vi.mocked(axios.get);

/** 테스트용 Fastify 앱 생성 */
async function createApp() {
  const app = Fastify();
  await app.register(tlsRoutes);
  return app;
}

describe('TLS 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/tls/ca ──────────────────────────────

  describe('GET /api/tls/ca', () => {
    it('프록시가 PEM을 반환할 때 200과 PEM 파일을 응답한다', async () => {
      // Proxy가 PEM 문자열을 정상 반환하는 상황
      const pem = '-----BEGIN CERTIFICATE-----\nABCDEF==\n-----END CERTIFICATE-----\n';
      mockAxiosGet.mockResolvedValueOnce({ data: pem });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-pem-file');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="smart-school-cdn-ca.crt"',
      );
      expect(res.body).toBe(pem);
    });

    it('프록시 연결 실패 시 502를 반환한다', async () => {
      // Proxy 관리 API 연결 실패 상황
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    });
  });

  // ─── GET /api/tls/ca/mobileconfig ────────────────

  describe('GET /api/tls/ca/mobileconfig', () => {
    it('프록시 HTTP에서 mobileconfig를 중계하여 200으로 응답한다', async () => {
      // Proxy :8080이 생성한 mobileconfig를 그대로 중계
      const profile = '<?xml version="1.0"?><plist><dict></dict></plist>';
      mockAxiosGet.mockResolvedValueOnce({ data: profile });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca/mobileconfig' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-apple-aspen-config');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="smart-school-cdn.mobileconfig"',
      );
      expect(res.body).toBe(profile);
    });

    it('프록시 연결 실패 시 502를 반환한다', async () => {
      // Proxy HTTP 연결 실패 상황
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca/mobileconfig' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    });
  });

  // ─── GET /api/tls/certificates ───────────────────

  describe('GET /api/tls/certificates', () => {
    it('프록시가 인증서 배열을 반환할 때 200과 목록을 응답한다', async () => {
      // Proxy가 발급된 인증서 목록을 정상 반환하는 상황
      const certs = [
        { domain: 'textbook.co.kr', issued_at: '2025-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' },
        { domain: 'cdn.edunet.net', issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-02-01T00:00:00Z' },
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: certs });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(certs);
    });

    it('프록시가 빈 배열을 반환할 때 200과 빈 배열을 응답한다', async () => {
      // 아직 발급된 인증서가 없는 상황
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('프록시 연결 실패 시 502를 반환한다', async () => {
      // Proxy 관리 API 연결 실패 상황
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    });
  });
});
