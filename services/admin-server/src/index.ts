import Fastify from 'fastify';
import cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { HealthMonitor } from './health-monitor.js';
import { proxyRoutes } from './routes/proxy.js';
import { cacheRoutes } from './routes/cache.js';
import { tlsRoutes } from './routes/tls.js';
import { domainRoutes } from './routes/domains.js';
import { systemRoutes } from './routes/system.js';
import { DomainRepository, DOMAIN_SCHEMA } from './db/domain-repo.js';
import { createStorageClient } from './grpc/storage_client.js';
import { createTlsClient } from './grpc/tls_client.js';
import { createDnsClient } from './grpc/dns_client.js';
import { createOptimizerClient } from './grpc/optimizer_client.js';
import { optimizerRoutes } from './routes/optimizer.js';
import { logRoutes } from './routes/logs.js';

// SQLite DB 초기화 — 앱 기동 시 1회 실행
const db = new Database(process.env.DB_PATH || './data/admin.db');
db.exec(DOMAIN_SCHEMA);

// 마이그레이션: 기존 DB에 새 컬럼이 없으면 추가 (003-domain-enhanced)
const existingCols = (db.pragma('table_info(domains)') as Array<{ name: string }>).map((c) => c.name);
if (!existingCols.includes('enabled')) db.exec('ALTER TABLE domains ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
if (!existingCols.includes('description')) db.exec("ALTER TABLE domains ADD COLUMN description TEXT NOT NULL DEFAULT ''");
if (!existingCols.includes('updated_at')) db.exec('ALTER TABLE domains ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');

// domain_stats 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS domain_stats (
    host TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_misses INTEGER NOT NULL DEFAULT 0,
    bandwidth INTEGER NOT NULL DEFAULT 0,
    avg_response_time INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (host, timestamp),
    FOREIGN KEY (host) REFERENCES domains(host) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_domain_stats_ts ON domain_stats(timestamp);
`);

const domainRepo = new DomainRepository(db);

// Rust 프록시 기본 도메인 시드 — 없으면 삽입, 있으면 무시
domainRepo.upsert('httpbin.org', 'https://httpbin.org');

const app = Fastify({ logger: true });

await app.register(cors);

// gRPC 클라이언트 생성 — 환경변수로 각 서비스 주소 주입 가능
// @grpc/grpc-js는 'host:port' 형식 필요 — 'http://' 프리픽스 제거
const grpcAddr = (url: string) => url.replace(/^https?:\/\//, '');
const storageClient = createStorageClient(grpcAddr(process.env.STORAGE_GRPC_URL ?? 'localhost:50051'));
const tlsClient = createTlsClient(grpcAddr(process.env.TLS_GRPC_URL ?? 'localhost:50052'));
const dnsClient = createDnsClient(grpcAddr(process.env.DNS_GRPC_URL ?? 'localhost:50053'));
const optimizerClient = createOptimizerClient(grpcAddr(process.env.OPTIMIZER_GRPC_URL ?? 'localhost:50054'));
const proxyAdminUrl = process.env.PROXY_ADMIN_URL ?? 'http://localhost:8081';

// Fastify 인스턴스에 gRPC 클라이언트 데코레이터 등록
app.decorate('storageClient', storageClient);
app.decorate('tlsClient', tlsClient);
app.decorate('dnsClient', dnsClient);
app.decorate('optimizerClient', optimizerClient);
app.decorate('proxyAdminUrl', proxyAdminUrl);
app.decorate('healthMonitor', new HealthMonitor({
  proxyAdminUrl,
  storageClient,
  tlsClient,
  dnsClient,
  optimizerClient,
  domainRepo,
  log: app.log,
}));

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

/** 시스템 헬스체크 API 라우트 등록 */
await app.register(systemRoutes);

/** 최적화 프로파일 + 절감 통계 API 라우트 등록 */
await app.register(optimizerRoutes);

/** 실시간 로그 스트리밍 SSE 라우트 등록 */
await app.register(logRoutes);

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
  // 전체 서비스 헬스 모니터 시작 — 5초마다 상태 수집·캐시, proxy 전환 시 sync
  app.healthMonitor.start();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
