// GET /api/system/status — HealthMonitor 캐시 반환 (downstream 직접 호출 없음)
import { FastifyInstance } from 'fastify';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/system/status', async () => app.healthMonitor.getSystemStatus());
}
