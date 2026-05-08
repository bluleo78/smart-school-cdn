/// TLS 관리 API 라우트
/// tls-service gRPC(50052)를 통해 CA 인증서·인증서 목록을 제공한다.
/// mobileconfig는 Proxy HTTP(8080)가 이미 생성하므로 직접 중계한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import type { DomainRepository } from '../db/domain-repo.js';

const PROXY_HTTP_URL = process.env.PROXY_HTTP_URL || 'http://localhost:8080';
const TIMEOUT_MS = 3000;

/**
 * host 입력 정규화 — DNS 호스트네임은 RFC 1035 §2.3.3에 의해 case-insensitive.
 * 다른 `/:host` 라우트(domains.ts)와 동일한 정규화를 적용해 멤버십 조회 키를 일관되게 맞춘다.
 */
function normalizeHost(input: string): string {
  return input.trim().toLowerCase();
}

/** 라우트 옵션 — domainRepo가 있으면 TLS 갱신 시 멤버십(등록 도메인) 검증에 사용 (#298) */
interface TlsRouteOptions {
  domainRepo?: DomainRepository;
}

export async function tlsRoutes(app: FastifyInstance, opts: TlsRouteOptions = {}) {
  const { domainRepo } = opts;
  /** CA 인증서 다운로드 (.crt) — tls-service gRPC로 cert_pem 조회 */
  app.get('/api/tls/ca', async (_req, reply) => {
    try {
      const res = await app.tlsClient.getCACert();
      return reply
        .header('Content-Type', 'application/x-pem-file')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn-ca.crt"')
        .send(res.cert_pem);
    } catch {
      // 표준 envelope (#327)
      return reply.status(502).send({
        error: 'tls_unreachable',
        message: 'tls-service에 연결할 수 없습니다.',
      });
    }
  });

  /** iOS 구성 프로파일 다운로드 — Proxy :8080이 이미 mobileconfig를 생성하므로 직접 중계 */
  app.get('/api/tls/ca/mobileconfig', async (_req, reply) => {
    try {
      const res = await axios.get<string>(`${PROXY_HTTP_URL}/ca.mobileconfig`, {
        timeout: TIMEOUT_MS,
        responseType: 'text',
      });
      return reply
        .header('Content-Type', 'application/x-apple-aspen-config')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn.mobileconfig"')
        .send(res.data);
    } catch {
      // 표준 envelope (#327)
      return reply.status(502).send({
        error: 'proxy_unreachable',
        message: 'Proxy 서버에 연결할 수 없습니다.',
      });
    }
  });

  /** 발급된 도메인 인증서 목록 — tls-service gRPC로 조회 */
  app.get('/api/tls/certificates', async (_req, reply) => {
    try {
      const res = await app.tlsClient.listCertificates();
      return res.certs ?? [];
    } catch {
      // 표준 envelope (#327)
      return reply.status(502).send({
        error: 'tls_unreachable',
        message: 'tls-service에 연결할 수 없습니다.',
      });
    }
  });

  /**
   * 도메인 TLS 인증서 갱신 — tls-service gRPC에 동기화 요청.
   *
   * (#298) 미등록 host에 대한 갱신 호출은 무의미(인증서가 발급되지 않거나 tls-service가 무시)하면서
   * 사용자에게 "성공"으로 표시되어 혼선을 만든다. 다른 `/:host` 라우트(sync/purge/toggle/DELETE)와
   * 일관되게 멤버십(`domainRepo.findByHost`) 검증을 추가하고, host 정규화도 동일하게 적용한다.
   */
  app.post<{ Params: { host: string } }>('/api/tls/renew/:host', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    // 멤버십 검증 — domainRepo가 주입된 경우에만 활성화 (테스트 호환성 유지)
    if (domainRepo) {
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        // 표준 envelope (#327)
        return reply.status(404).send({
          error: 'domain_not_found',
          message: '도메인을 찾을 수 없습니다.',
        });
      }
    }
    try {
      await app.tlsClient.syncDomains([{ host, origin: '' }]);
      return { success: true, host };
    } catch (err) {
      // 표준 envelope (#327)
      return reply.status(502).send({
        error: 'tls_renew_failed',
        message: 'TLS 갱신 실패',
        detail: (err as Error).message,
      });
    }
  });
}
