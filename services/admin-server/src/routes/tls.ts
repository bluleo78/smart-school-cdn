/// TLS 관리 API 라우트
/// Proxy Service 관리 API(8081)를 중계하여 CA 인증서·iOS 프로파일·인증서 목록을 제공한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { createHash } from 'crypto';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';
const TIMEOUT_MS = 3000;

/** 발급된 인증서 정보 */
interface CertInfo {
  domain: string;
  issued_at: string;
  expires_at: string;
}

/** CA PEM 해시 기반 결정론적 UUID 생성 — 같은 CA는 항상 같은 UUID */
function pemToUuid(pem: string): string {
  const hash = createHash('sha256').update(pem).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),  // version 5
    '8' + hash.slice(17, 20),  // variant
    hash.slice(20, 32),
  ].join('-');
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

      // CA PEM 기반 결정론적 UUID 생성
      const innerUuid = pemToUuid(pem);
      const outerUuid = pemToUuid(pem + 'outer');

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
            <string>${innerUuid}</string>
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
    <string>${outerUuid}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

      return reply
        .header('Content-Type', 'application/x-apple-aspen-config')
        .header('Content-Disposition', 'attachment; filename="smart-school-cdn.mobileconfig"')
        .send(profile);
    } catch {
      // 인증서 다운로드 실패는 graceful degradation 불가 — 사용자에게 명시적 에러 표시
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
