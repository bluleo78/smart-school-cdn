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

/** 테스트용 Fastify 앱 생성 — tlsClient 데코레이터 주입 + (옵션) domainRepo 주입 */
async function createApp(opts: { domainRepo?: { findByHost: (h: string) => unknown } } = {}) {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('tlsClient', mockTlsClient as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(tlsRoutes, { domainRepo: opts.domainRepo as any });
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
      // 표준 envelope (#327)
      expect(res.json()).toEqual({
        error: 'tls_unreachable',
        message: 'tls-service에 연결할 수 없습니다.',
      });
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
      // 표준 envelope (#327)
      expect(res.json()).toEqual({
        error: 'proxy_unreachable',
        message: 'Proxy 서버에 연결할 수 없습니다.',
      });
    });
  });

  // ─── GET /api/tls/certificates ───────────────────

  describe('GET /api/tls/certificates', () => {
    it('tls-service가 인증서 배열을 반환할 때 200과 목록을 응답한다 — days_until_expiry/severity 파생 필드 포함 (#367)', async () => {
      // 만료 기준점 자유 — severity 분류만 검증 (실제 days 는 now 의존)
      const certs = [
        { domain: 'textbook.co.kr', issued_at: '2025-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, // 안전
        { domain: 'cdn.edunet.net', issued_at: '2025-01-01T00:00:00Z', expires_at: '2025-02-01T00:00:00Z' }, // 이미 만료
      ];
      mockTlsClient.listCertificates.mockResolvedValueOnce({ certs });

      const app = await createApp();
      const res = await app.inject({ method: 'GET', url: '/api/tls/certificates' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ domain: string; severity: string; days_until_expiry: number }>;
      expect(body).toHaveLength(2);
      const byDomain = Object.fromEntries(body.map((c) => [c.domain, c]));
      expect(byDomain['textbook.co.kr'].severity).toBe('none');
      expect(byDomain['textbook.co.kr'].days_until_expiry).toBeGreaterThan(30);
      expect(byDomain['cdn.edunet.net'].severity).toBe('critical');
      expect(byDomain['cdn.edunet.net'].days_until_expiry).toBeLessThan(0);
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
      // 표준 envelope (#327)
      expect(res.json()).toEqual({
        error: 'tls_unreachable',
        message: 'tls-service에 연결할 수 없습니다.',
      });
    });
  });

  // ─── POST /api/tls/renew/:host ───────────────────
  // (#298) 멤버십 검증 — 미등록 host는 404, 등록 host만 갱신을 진행한다.

  describe('POST /api/tls/renew/:host', () => {
    /**
     * 미등록 host 입력 시 syncDomains를 호출하지 않고 404로 거부한다.
     * 다른 도메인 액션 라우트(sync/purge/toggle/DELETE)와 동일한 메시지·상태 코드.
     */
    it('등록되지 않은 도메인 갱신 요청은 404로 거부한다', async () => {
      const domainRepo = { findByHost: vi.fn().mockReturnValue(undefined) };
      const app = await createApp({ domainRepo });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tls/renew/nope.example',
      });

      expect(res.statusCode).toBe(404);
      // 표준 envelope (#327)
      expect(res.json()).toEqual({
        error: 'domain_not_found',
        message: '도메인을 찾을 수 없습니다.',
      });
      expect(domainRepo.findByHost).toHaveBeenCalledWith('nope.example');
      // 미등록 도메인은 tls-service까지 가지 않는다
      expect(mockTlsClient.syncDomains).not.toHaveBeenCalled();
    });

    /**
     * host 정규화 검증 — 대문자 입력이라도 lowercase 키로 멤버십 조회·갱신이 이뤄진다.
     * 다른 `/:host` 라우트의 normalizeHost 패턴과 일관.
     */
    it('대소문자가 섞인 host도 정규화되어 멤버십 조회·갱신된다', async () => {
      const domainRepo = {
        findByHost: vi.fn().mockReturnValue({ host: 'textbook.co.kr' }),
      };
      mockTlsClient.syncDomains.mockResolvedValueOnce({});
      const app = await createApp({ domainRepo });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tls/renew/Textbook.CO.KR',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, host: 'textbook.co.kr' });
      expect(domainRepo.findByHost).toHaveBeenCalledWith('textbook.co.kr');
      expect(mockTlsClient.syncDomains).toHaveBeenCalledWith([
        { host: 'textbook.co.kr', origin: '' },
      ]);
    });

    /**
     * 등록된 host에 대해 syncDomains 호출 후 success 응답.
     */
    it('등록된 도메인은 syncDomains 호출 후 success를 반환한다', async () => {
      const domainRepo = {
        findByHost: vi.fn().mockReturnValue({ host: 'cdn.edunet.net' }),
      };
      mockTlsClient.syncDomains.mockResolvedValueOnce({});
      const app = await createApp({ domainRepo });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tls/renew/cdn.edunet.net',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, host: 'cdn.edunet.net' });
      expect(mockTlsClient.syncDomains).toHaveBeenCalledWith([
        { host: 'cdn.edunet.net', origin: '' },
      ]);
    });

    /**
     * 등록된 host지만 tls-service 연결이 실패하면 502.
     */
    it('등록된 도메인이라도 tls-service 실패 시 502를 반환한다', async () => {
      const domainRepo = {
        findByHost: vi.fn().mockReturnValue({ host: 'cdn.edunet.net' }),
      };
      mockTlsClient.syncDomains.mockRejectedValueOnce(new Error('UNAVAILABLE'));
      const app = await createApp({ domainRepo });

      const res = await app.inject({
        method: 'POST',
        url: '/api/tls/renew/cdn.edunet.net',
      });

      expect(res.statusCode).toBe(502);
      // 표준 envelope (#327)
      expect(res.json()).toMatchObject({
        error: 'tls_renew_failed',
        message: 'TLS 갱신 실패',
      });
    });
  });
});
