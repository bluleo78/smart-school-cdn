import Fastify from 'fastify';
import cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { proxyRoutes } from './routes/proxy.js';
import { DomainRepository, DOMAIN_SCHEMA } from './db/domain-repo.js';

// SQLite DB 초기화 — 앱 기동 시 1회 실행
const db = new Database(process.env.DB_PATH || './data/admin.db');
db.exec(DOMAIN_SCHEMA);
const domainRepo = new DomainRepository(db);

const app = Fastify({ logger: true });

await app.register(cors);

/** 헬스체크 엔드포인트 */
app.get('/api/health', async () => {
  return { status: 'ok' };
});

/** 프록시 상태/로그 API 라우트 등록 */
await app.register(proxyRoutes, { domainRepo });

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
