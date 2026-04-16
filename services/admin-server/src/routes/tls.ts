/// TLS 관리 API 라우트
/// tls-service gRPC(50052)를 통해 CA 인증서·인증서 목록을 제공한다.
/// mobileconfig는 Proxy HTTP(8080)가 이미 생성하므로 직접 중계한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';

const PROXY_HTTP_URL = process.env.PROXY_HTTP_URL || 'http://localhost:8080';
const TIMEOUT_MS = 3000;

export async function tlsRoutes(app: FastifyInstance) {
  /** CA 인증서 다운로드 (.crt) — tls-service gRPC로 cert_pem 조회 */
  app.get('/api/tls/ca', async (_req, reply) => {
    try {
      const res = await app.tlsClient.getCACert();
      return reply
        .header('Content-Type', 'application/x-pem-file')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn-ca.crt"')
        .send(res.cert_pem);
    } catch {
      return reply.status(502).send({ error: 'tls-service에 연결할 수 없습니다.' });
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
      return reply.status(502).send({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    }
  });

  /** 발급된 도메인 인증서 목록 — tls-service gRPC로 조회 */
  app.get('/api/tls/certificates', async (_req, reply) => {
    try {
      const res = await app.tlsClient.listCertificates();
      return res.certs ?? [];
    } catch {
      return reply.status(502).send({ error: 'tls-service에 연결할 수 없습니다.' });
    }
  });

  /** 도메인 TLS 인증서 갱신 — tls-service gRPC에 동기화 요청 */
  app.post<{ Params: { host: string } }>('/api/tls/renew/:host', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    try {
      await app.tlsClient.syncDomains([{ host, origin: '' }]);
      return { success: true, host };
    } catch (err) {
      return reply.status(502).send({
        error: 'TLS 갱신 실패',
        detail: (err as Error).message,
      });
    }
  });
}
