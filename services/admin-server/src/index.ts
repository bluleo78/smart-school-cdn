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
import { OPTIMIZATION_EVENTS_SCHEMA, OptimizationEventsRepository } from './db/optimization-events-repo.js';
import { USER_SCHEMA, UserRepository } from './db/user-repo.js';
import { startStatsCollector } from './stats-collector.js';
import { startDnsMetricsCollector } from './dns-metrics-collector.js';
import { startOptimizationEventsPruner } from './optimization-events-pruner.js';
import { startDomainStatsPruner } from './domain-stats-pruner.js';
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
import { registerErrorHandlers } from './error-handlers.js';

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

// origin 정규화 마이그레이션 — 이슈 #191
// 기존에 trailing slash / 대문자 호스트 / path 가 포함된 채 저장된 origin 들을
// `URL.origin` 형태(scheme://host[:port])로 일괄 정규화한다.
// path 가 포함된 row 도 host-level origin 만 남기는 의도이며, 정규화 후 동일 host 로
// 충돌이 발생하면 더 짧은(원형에 가까운) origin 을 keeper 로 두고 나머지는 그대로 둔다 —
// host 는 PK 라 origin 충돌은 발생하지 않는다.
{
  type DomainRow = { host: string; origin: string };
  const rows = db.prepare('SELECT host, origin FROM domains').all() as DomainRow[];
  const tx = db.transaction(() => {
    for (const r of rows) {
      try {
        const normalized = new URL(r.origin).origin;
        if (normalized !== r.origin) {
          db.prepare('UPDATE domains SET origin = ? WHERE host = ?').run(normalized, r.host);
        }
      } catch {
        // 파싱 실패 row 는 그대로 둔다 (기존 동작 보존, 추후 사용자가 수정).
      }
    }
  });
  tx();
}

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

// username 정규화 마이그레이션 — 이슈 #190
// 과거에 case-sensitive 로 저장된 username 들을 모두 lower-case 로 변환한다.
// lower 형태로 변환했을 때 충돌이 발생하면(이미 같은 lower 값이 다른 행에 존재),
// 활성 계정(disabled_at IS NULL) 우선, 그다음 id 작은 쪽을 keeper 로 두고
// 나머지는 disabled_at 을 채운 채 그대로 남긴다(데이터 보존). keeper 의 username
// 만 lower 로 update.
{
  type DupRow = { id: number; username: string; disabled_at: string | null };
  const rows = db.prepare('SELECT id, username, disabled_at FROM users').all() as DupRow[];
  // lower 키 → 후보 행 그룹
  const groups = new Map<string, DupRow[]>();
  for (const r of rows) {
    const k = r.username.trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const [lower, list] of groups) {
      // 모두 이미 lower 와 동일하면 스킵
      if (list.length === 1 && list[0].username === lower) continue;
      // keeper 선정: 활성 행 우선, 그다음 id 작은 쪽
      list.sort((a, b) => {
        const aActive = a.disabled_at === null ? 0 : 1;
        const bActive = b.disabled_at === null ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.id - b.id;
      });
      const [keeper, ...losers] = list;
      // losers 는 username 충돌이 발생하지 않도록 prefix 를 붙여 보존하고 disable 처리
      for (const loser of losers) {
        if (loser.disabled_at === null) {
          db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?')
            .run(now, now, loser.id);
        }
        // username 에 disabled prefix 를 붙여 lower 형태와 충돌하지 않게 한다.
        // 예: BLULEO78@gmail.com → __dup_3__BLULEO78@gmail.com (id=3 보존)
        if (!loser.username.startsWith('__dup_')) {
          db.prepare('UPDATE users SET username = ? WHERE id = ?')
            .run(`__dup_${loser.id}__${loser.username}`, loser.id);
        }
      }
      // keeper 를 lower 로 갱신 (이미 lower 면 skip)
      if (keeper.username !== lower) {
        db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?')
          .run(lower, now, keeper.id);
      }
    }
  });
  tx();
}

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

// 캐시 차단 훅 — `/api/*` 모든 응답에 Cache-Control: no-store 부착 (#316)
// 이유: admin-server 응답은 인증 세션·도메인 목록·로그 등 민감 데이터를 포함한다.
// 헤더가 비어 있으면 브라우저 bfcache·service worker·내부망 중간 프록시가
// 캐시할 수 있어 로그아웃 후 뒤로가기 시 이전 화면 노출, 다른 사용자에게 응답 재사용
// 같은 위험이 있다. Pragma: no-cache 는 HTTP/1.0 레거시 클라이언트 호환용.
//
// 주의: SSE 스트리밍 라우트(routes/logs.ts:148~)는 reply.raw.writeHead 로
// 헤더를 직접 쓰기 때문에 Fastify onSend 를 우회한다 — 해당 라우트는 자체적으로
// Cache-Control: no-cache 를 이미 설정하므로 영향 없음.
app.addHook('onSend', async (req, reply, payload) => {
  if (req.url.startsWith('/api/')) {
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
  }
  return payload;
});

// CORS 설정 — admin-server는 내부 전용이므로 허용 origin을 명시적으로 제한한다.
// 와일드카드(`*`) + credentials 조합은 브라우저가 거부하고, 외부 origin이 쿠키 세션을
// 탈취할 수 있으므로 허용 origin을 허용 목록으로 제한한다.
// 운영 배포 시 ALLOWED_ORIGINS 환경변수로 admin-web 주소만 허용 (콤마 구분).
// 프로덕션에서 ALLOWED_ORIGINS 미설정 시 개발용 localhost가 fallback되는 보안 위험 방지 (#160):
// - NODE_ENV=production 이면 즉시 종료 (운영 배포 설정 누락 방어)
// - 개발/테스트 환경에서는 localhost fallback 유지 (DX 보존)
if (!process.env.ALLOWED_ORIGINS && process.env.NODE_ENV === 'production') {
  console.error('ALLOWED_ORIGINS 환경변수 필수 (production 환경) — 허용할 admin-web origin을 콤마로 구분하여 설정하세요.');
  process.exit(1);
}
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:4173', 'http://localhost:7777'];
await app.register(cors, {
  origin: allowedOrigins,
  credentials: true,  // HttpOnly 쿠키 세션 사용 — credentials 허용 필수
});

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

/** TLS 인증서 관리 API 라우트 등록 — 갱신 시 멤버십 검증을 위해 domainRepo 주입 (#298) */
await app.register(tlsRoutes, { domainRepo });

/** 도메인 관리 API 라우트 등록 */
await app.register(domainRoutes, { domainRepo });

/** 시스템 헬스체크 API 라우트 등록 */
await app.register(systemRoutes);

/** 최적화 프로파일 + 절감 통계 API 라우트 등록 — PUT 시 멤버십 검증을 위해 domainRepo 주입 (#309) */
await app.register(optimizerRoutes, { domainRepo });

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

// 에러 응답 envelope 통일 (#175) — not-found / schema validation / 미잡힌 throw 정규화
registerErrorHandlers(app);

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
  // 전체 서비스 헬스 모니터 시작 — 5초마다 상태 수집·캐시, proxy 전환 시 sync
  app.healthMonitor.start();
  // Proxy 통계 폴링 시작 — 1분마다 /stats 엔드포인트에서 수집하여 DB에 저장
  const statsRepo = new DomainStatsRepository(db);
  startStatsCollector(proxyAdminUrl, statsRepo, app.log);
  // domain_stats retention 프루너 시작 — 1시간마다 30일 이전 통계 삭제 (#338)
  // optimization-events-pruner와 동일 패턴: 부팅 시 1회 + setInterval 주기 tick
  startDomainStatsPruner({ repo: statsRepo, log: app.log });
  // DNS 메트릭 폴링 시작 — 1분마다 dns-service GetStats 호출, 델타 계산 후 DB에 저장
  startDnsMetricsCollector({
    getStats: () => dnsClient.getStats(),
    repo: dnsMetricsRepo,
    log: app.log,
  });
  // optimization_events retention 프루너 시작 — 1시간마다 30일 이전 이벤트 삭제 (#337)
  startOptimizationEventsPruner({
    repo: new OptimizationEventsRepository(db),
    log: app.log,
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
