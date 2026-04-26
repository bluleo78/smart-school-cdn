import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import { HealthMonitor } from './health-monitor.js';
import { proxyRoutes } from './routes/proxy.js';
import { cacheRoutes } from './routes/cache.js';
import { tlsRoutes } from './routes/tls.js';
import { domainRoutes } from './routes/domains.js';
import { systemRoutes } from './routes/system.js';
import { DomainRepository, DOMAIN_SCHEMA } from './db/domain-repo.js';
import { DomainStatsRepository } from './db/domain-stats-repo.js';
import { DnsMetricsRepository, DNS_METRICS_SCHEMA } from './db/dns-metrics-repo.js';
import { OPTIMIZATION_EVENTS_SCHEMA } from './db/optimization-events-repo.js';
import { USER_SCHEMA, UserRepository } from './db/user-repo.js';
import { startStatsCollector } from './stats-collector.js';
import { startDnsMetricsCollector } from './dns-metrics-collector.js';
import { createStorageClient } from './grpc/storage_client.js';
import { createTlsClient } from './grpc/tls_client.js';
import { createDnsClient } from './grpc/dns_client.js';
import { createOptimizerClient } from './grpc/optimizer_client.js';
import { optimizerRoutes } from './routes/optimizer.js';
import { dnsRoutes } from './routes/dns.js';
import { logRoutes } from './routes/logs.js';
import { optimizationEventsRoutes } from './routes/optimization-events.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { internalRoutes } from './routes/internal.js';
import { requireAuth } from './auth/require-auth.js';
import { requireInternalToken } from './auth/require-internal-token.js';

// 보안 기동 가드 — JWT_SECRET / INTERNAL_API_TOKEN 미설정 시 즉시 종료.
// 32자 미만이면 HMAC 충돌·brute-force 위험이 무시 못 할 수준이라 거부한다.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET 환경변수 필수 (32자 이상)');
  process.exit(1);
}
if (!process.env.INTERNAL_API_TOKEN || process.env.INTERNAL_API_TOKEN.length < 32) {
  console.error('INTERNAL_API_TOKEN 환경변수 필수 (32자 이상)');
  process.exit(1);
}

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

// domain_stats 테이블 마이그레이션 — Phase 12 (캐시 통계 재설계)
// L1/L2 히트와 4분류 BYPASS 카운터를 컬럼으로 분리. 과거 row는 default 0으로 자동 채워짐.
const colsStats = (db.pragma('table_info(domain_stats)') as Array<{ name: string }>).map((c) => c.name);
if (!colsStats.includes('l1_hits'))        db.exec('ALTER TABLE domain_stats ADD COLUMN l1_hits        INTEGER NOT NULL DEFAULT 0');
if (!colsStats.includes('l2_hits'))        db.exec('ALTER TABLE domain_stats ADD COLUMN l2_hits        INTEGER NOT NULL DEFAULT 0');
if (!colsStats.includes('bypass_method'))  db.exec('ALTER TABLE domain_stats ADD COLUMN bypass_method  INTEGER NOT NULL DEFAULT 0');
if (!colsStats.includes('bypass_nocache')) db.exec('ALTER TABLE domain_stats ADD COLUMN bypass_nocache INTEGER NOT NULL DEFAULT 0');
if (!colsStats.includes('bypass_size'))    db.exec('ALTER TABLE domain_stats ADD COLUMN bypass_size    INTEGER NOT NULL DEFAULT 0');
if (!colsStats.includes('bypass_other'))   db.exec('ALTER TABLE domain_stats ADD COLUMN bypass_other   INTEGER NOT NULL DEFAULT 0');

// DNS 메트릭 버킷 테이블 생성 — Phase A: 1분 단위 카운터 델타 저장
db.exec(DNS_METRICS_SCHEMA);

// 최적화 이벤트 테이블 생성 — Phase 13/14/15 공용 관찰 인프라
db.exec(OPTIMIZATION_EVENTS_SCHEMA);

// 관리자 사용자 테이블 생성 — Task 1/6 인증 인프라
db.exec(USER_SCHEMA);

// 외래 키 제약 활성화 — 도메인 삭제 시 cascade 동작에 필요
db.pragma('foreign_keys = ON');

const domainRepo = new DomainRepository(db);
const dnsMetricsRepo = new DnsMetricsRepository(db);
const userRepo = new UserRepository(db);

// Rust 프록시 기본 도메인 시드 — 없으면 삽입, 있으면 무시
domainRepo.upsert('httpbin.org', 'https://httpbin.org');

const app = Fastify({ logger: true });

// 쿠키 플러그인은 인증 훅이 req.cookies 를 읽으므로 훅 등록 이전에 register.
await app.register(cookie);

// rate-limit 플러그인 — global: false 로 등록해 라우트별 개별 설정만 동작하도록 한다.
// 전역 적용 시 SSE 스트림·내부 서비스간 호출·헬스체크 등이 제한될 수 있어 명시적 opt-in 방식 채택.
// 주의: 리버스 프록시(nginx) 뒤 배포 시 실제 클라이언트 IP를 얻으려면 trustProxy 설정 필요.
await app.register(rateLimit, { global: false });

// preHandler 훅 — 등록 순서가 실행 순서. 토큰 검사를 먼저 수행해
// /internal/* 의 인증 실패가 즉시 401 로 끊기도록 한다.
app.addHook('preHandler', requireInternalToken);
app.addHook('preHandler', requireAuth);

await app.register(cors);

// gRPC 클라이언트 생성 — 환경변수로 각 서비스 주소 주입 가능
// @grpc/grpc-js는 'host:port' 형식 필요 — 'http://' 프리픽스 제거
const grpcAddr = (url: string) => url.replace(/^https?:\/\//, '');
const storageClient = createStorageClient(grpcAddr(process.env.STORAGE_GRPC_URL ?? 'localhost:50051'));
const tlsClient = createTlsClient(grpcAddr(process.env.TLS_GRPC_URL ?? 'localhost:50052'));
const dnsClient = createDnsClient(grpcAddr(process.env.DNS_GRPC_URL ?? 'localhost:50053'));
const optimizerClient = createOptimizerClient(grpcAddr(process.env.OPTIMIZER_GRPC_URL ?? 'localhost:50054'));
const proxyAdminUrl = process.env.PROXY_ADMIN_URL ?? 'http://localhost:8081';

// Fastify 인스턴스에 gRPC 클라이언트 및 DB 데코레이터 등록
app.decorate('db', db);
app.decorate('storageClient', storageClient);
app.decorate('tlsClient', tlsClient);
app.decorate('dnsClient', dnsClient);
app.decorate('optimizerClient', optimizerClient);
app.decorate('dnsMetricsRepo', dnsMetricsRepo);
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

/** DNS 상태/레코드/쿼리/메트릭 API 라우트 등록 */
await app.register(dnsRoutes);

/** 실시간 로그 스트리밍 SSE 라우트 등록 */
await app.register(logRoutes);

/** 최적화 이벤트 관찰 API 라우트 등록 (Phase 13/14/15 공용) */
await app.register(optimizationEventsRoutes);

/** 인증 라우트 (state/setup/login/logout) — requireAuth 가 /api/auth/* 스킵 */
await app.register(authRoutes, { userRepo });

/** 사용자 CRUD 라우트 — requireAuth 보호 */
await app.register(usersRoutes, { userRepo });

/** 서비스간 내부 호출 라우트 — requireInternalToken 보호 */
await app.register(internalRoutes, { domainRepo });

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
  // 전체 서비스 헬스 모니터 시작 — 5초마다 상태 수집·캐시, proxy 전환 시 sync
  app.healthMonitor.start();
  // Proxy 통계 폴링 시작 — 1분마다 /stats 엔드포인트에서 수집하여 DB에 저장
  const statsRepo = new DomainStatsRepository(db);
  startStatsCollector(proxyAdminUrl, statsRepo, app.log);
  // DNS 메트릭 폴링 시작 — 1분마다 dns-service GetStats 호출, 델타 계산 후 DB에 저장
  startDnsMetricsCollector({
    getStats: () => dnsClient.getStats(),
    repo: dnsMetricsRepo,
    log: app.log,
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
