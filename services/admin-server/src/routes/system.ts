// GET /api/system/status — 4개 서비스(proxy, storage, tls, dns) 헬스체크 집계
import { FastifyInstance } from 'fastify';

interface ServiceStatus { online: boolean; latency_ms: number; }

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/system/status', async (_req, reply) => {
    const TIMEOUT_MS = 2000;

    // 개별 서비스 헬스체크를 타임아웃과 함께 실행 — 실패 시 offline 반환
    const measure = async (fn: () => Promise<{ online: boolean; latency_ms: number }>): Promise<ServiceStatus> => {
      const t0 = Date.now();
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
        ]);
        return { online: result.online, latency_ms: Date.now() - t0 };
      } catch {
        return { online: false, latency_ms: -1 };
      }
    };

    // Proxy는 HTTP /status 엔드포인트로 확인
    const proxyCheck = async (): Promise<ServiceStatus> => {
      const t0 = Date.now();
      try {
        const url = app.proxyAdminUrl + '/status';
        const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        return { online: r.ok, latency_ms: Date.now() - t0 };
      } catch {
        return { online: false, latency_ms: -1 };
      }
    };

    const [proxy, storage, tls, dns] = await Promise.all([
      proxyCheck(),
      measure(() => app.storageClient.health()),
      measure(() => app.tlsClient.health()),
      measure(() => app.dnsClient.health()),
    ]);

    reply.send({ proxy, storage, tls, dns });
  });
}
