/// TLS 관리 API 라우트
/// Proxy Service 관리 API(8081)를 중계하여 CA 인증서·인증서 목록을 제공한다.
/// mobileconfig는 Proxy HTTP(8080)가 이미 생성하므로 직접 중계한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';
const PROXY_HTTP_URL = process.env.PROXY_HTTP_URL || 'http://localhost:8080';
const TIMEOUT_MS = 3000;

/** 발급된 인증서 정보 */
interface CertInfo {
  domain: string;
  issued_at: string;
  expires_at: string;
}

export async function tlsRoutes(app: FastifyInstance) {
  /** CA 인증서 다운로드 (.crt) */
  app.get('/api/tls/ca', async (_req, reply) => {
    try {
      const res = await axios.get<string>(`${PROXY_ADMIN_URL}/tls/ca`, {
        timeout: TIMEOUT_MS,
        responseType: 'text',
      });
      return reply
        .header('Content-Type', 'application/x-pem-file')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn-ca.crt"')
        .send(res.data);
    } catch {
      return reply.status(502).send({ error: 'Proxy 서버에 연결할 수 없습니다.' });
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

  /** 발급된 도메인 인증서 목록 */
  app.get('/api/tls/certificates', async (_req, reply) => {
    try {
      const res = await axios.get<CertInfo[]>(
        `${PROXY_ADMIN_URL}/tls/certificates`,
        { timeout: TIMEOUT_MS },
      );
      return res.data;
    } catch {
      return reply.status(502).send({ error: 'Proxy 서버에 연결할 수 없습니다.' });
    }
  });
}
