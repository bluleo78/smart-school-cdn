/// TLS 관리 API 라우트
/// Proxy Service 관리 API(8081)를 중계하여 CA 인증서·iOS 프로파일·인증서 목록을 제공한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';
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

  /** iOS 구성 프로파일 다운로드 (.mobileconfig) */
  app.get('/api/tls/ca/mobileconfig', async (_req, reply) => {
    try {
      const res = await axios.get<string>(`${PROXY_ADMIN_URL}/tls/ca`, {
        timeout: TIMEOUT_MS,
        responseType: 'text',
      });
      const pem: string = res.data;

      // PEM 헤더·푸터·줄바꿈 제거 → base64 DER
      const b64 = pem
        .split('\n')
        .filter((line) => !line.startsWith('-----'))
        .join('');

      const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>ca.crt</string>
            <key>PayloadContent</key>
            <data>${b64}</data>
            <key>PayloadDescription</key>
            <string>Smart School CDN 루트 인증 기관</string>
            <key>PayloadDisplayName</key>
            <string>Smart School CDN CA</string>
            <key>PayloadIdentifier</key>
            <string>com.smartschool.cdn.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Smart School CDN</string>
    <key>PayloadIdentifier</key>
    <string>com.smartschool.cdn</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>B2C3D4E5-F6A7-8901-BCDE-F12345678901</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

      return reply
        .header('Content-Type', 'application/x-apple-aspen-config')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn.mobileconfig"')
        .send(profile);
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
