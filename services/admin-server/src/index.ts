import Fastify from 'fastify';
import cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { proxyRoutes } from './routes/proxy.js';
import { cacheRoutes } from './routes/cache.js';
import { tlsRoutes } from './routes/tls.js';
import { domainRoutes, syncToProxy } from './routes/domains.js';
import { DomainRepository, DOMAIN_SCHEMA } from './db/domain-repo.js';

// SQLite DB 초기화 — 앱 기동 시 1회 실행
const db = new Database(process.env.DB_PATH || './data/admin.db');
db.exec(DOMAIN_SCHEMA);
const domainRepo = new DomainRepository(db);

// Rust 프록시 기본 도메인 시드 — 없으면 삽입, 있으면 무시
domainRepo.upsert('httpbin.org', 'https://httpbin.org');

const app = Fastify({ logger: true });

await app.register(cors);

/** 헬스체크 엔드포인트 */
app.get('/api/health', async () => {
  return { status: 'ok' };
});

/** 프록시 상태/로그 API 라우트 등록 */
await app.register(proxyRoutes, { domainRepo });

/** 캐시 통계/퍼지 API 라우트 등록 */
await app.register(cacheRoutes);

/** TLS 인증서 관리 API 라우트 등록 */
await app.register(tlsRoutes);

/** 도메인 관리 API 라우트 등록 */
await app.register(domainRoutes, { domainRepo });

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
  // Proxy 재시작 대비: 시작 시 현재 도메인 목록을 Proxy에 push
  await syncToProxy(domainRepo);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
