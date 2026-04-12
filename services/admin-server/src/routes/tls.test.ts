/// TLS 라우트 유닛 테스트
/// tlsClient Fastify 데코레이터(gRPC)와 axios(mobileconfig 중계)를 모킹하여 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { tlsRoutes } from './tls.js';

// mobileconfig 엔드포인트는 여전히 Proxy HTTP 중계에 axios 사용
vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import axios from 'axios';
const mockAxiosGet = vi.mocked(axios.get);

/** 테스트용 tlsClient mock */
const mockTlsClient = {
  getCACert:        vi.fn(),
  listCertificates: vi.fn(),
  syncDomains:      vi.fn(),
  health:           vi.fn(),
};

/** 테스트용 Fastify 앱 생성 — tlsClient 데코레이터 주입 */
async function createApp() {
  const app = Fastify({ logger: false });
  app.decorate('tlsClient', mockTlsClient);
  await app.register(tlsRoutes);
  return app;
}

describe('TLS 라우트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/tls/ca ──────────────────────────────

  describe('GET /api/tls/ca', () => {
    it('tls-service가 PEM을 반환할 때 200과 PEM 파일을 응답한다', async () => {
      const pem = '-----BEGIN CERTIFICATE-----\nABCDEF==\n-----END CERTIFICATE-----\n';
      mockTlsClient.getCACert.mockResolvedValueOnce({ cert_pem: pem });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-pem-file');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="smart-school-cdn-ca.crt"',
      );
      expect(res.body).toBe(pem);
    });

    it('tls-service 연결 실패 시 502를 반환한다', async () => {
      mockTlsClient.getCACert.mockRejectedValueOnce(new Error('UNAVAILABLE'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'tls-service에 연결할 수 없습니다.' });
    });
  });

  // ─── GET /api/tls/ca/mobileconfig ────────────────

  describe('GET /api/tls/ca/mobileconfig', () => {
    it('프록시 HTTP에서 mobileconfig를 중계하여 200으로 응답한다', async () => {
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
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/ca/mobileconfig' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    });
  });

  // ─── GET /api/tls/certificates ───────────────────

  describe('GET /api/tls/certificates', () => {
    it('tls-service가 인증서 배열을 반환할 때 200과 목록을 응답한다', async () => {
      const certs = [
        { domain: 'textbook.co.kr', issued_at: '2025-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' },
        { domain: 'cdn.edunet.net', issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-02-01T00:00:00Z' },
      ];
      mockTlsClient.listCertificates.mockResolvedValueOnce({ certs });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(certs);
    });

    it('tls-service가 빈 배열을 반환할 때 200과 빈 배열을 응답한다', async () => {
      mockTlsClient.listCertificates.mockResolvedValueOnce({ certs: [] });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('tls-service 연결 실패 시 502를 반환한다', async () => {
      mockTlsClient.listCertificates.mockRejectedValueOnce(new Error('UNAVAILABLE'));

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'tls-service에 연결할 수 없습니다.' });
    });
  });
});
