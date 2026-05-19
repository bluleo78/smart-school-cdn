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
import {
  TLS_EXPIRY_ALERTS_SCHEMA,
  startTlsExpiryScanner,
  createSinksFromEnv,
} from './tls-expiry-scanner.js';
import { startSqliteMaintenance } from './sqlite-maintenance.js';
import path from 'node:path';
import { createStorageClient } from './grpc/storage_client.js';
import { createTlsClient } from './grpc/tls_client.js';
import { createDnsClient } from './grpc/dns_client.js';
import { createOptimizerClient } from './grpc/optimizer_client.js';
import { optimizerRoutes } from './routes/optimizer.js';
import { dnsRoutes } from './routes/dns.js';
import { logRoutes } from './routes/logs.js';
import { optimizationEventsRoutes } from './routes/optimization-events.js';
import { diagnoseRoutes } from './routes/diagnose.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { internalRoutes } from './routes/internal.js';
import { createRequireAuth } from './auth/require-auth.js';
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
const dbPath = process.env.DB_PATH || './data/admin.db';
const db = new Database(dbPath);

// 운영 PRAGMA — 동시성·내구성·백업 안전성 균형
// - WAL: 단일 라이터/다중 리더 동시성 향상 (SSE/스트림 + stats-collector 환경에서 SQLITE_BUSY 회피)
// - synchronous=NORMAL: WAL과 짝, FULL 대비 fsync 비용 절감하면서도 충분한 내구성
// - busy_timeout=5000: 짧은 락 경합 시 즉시 SQLITE_BUSY 대신 5초까지 대기 후 재시도
// - wal_autocheckpoint=1000: WAL 파일 비대화 방지 (1000 페이지 ≈ 4MB 마다 자동 체크포인트)
// 백업 시 admin.db / admin.db-wal / admin.db-shm 동행 카피 또는 .backup/VACUUM INTO 사용 필요.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');

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

// 이슈 #367 — TLS 인증서 만료 임박 단발 알림 추적 테이블 (domain, threshold_day) PK
db.exec(TLS_EXPIRY_ALERTS_SCHEMA);

// optimization_events.ts 컬럼 형식 마이그레이션 — 이슈 #377
// 무엇을: 기존 DB 의 ts 컬럼이 TEXT (ISO 8601) 면 INTEGER unix-sec 로 재생성하며 모든 행을 변환한다.
// 왜: docs/architecture.md §6-2 Timestamp 규약(DB 컬럼 = INTEGER unix-sec 단일 형식)에 맞추기 위함.
//    repo I/O 는 여전히 ISO 8601 을 수용/반환(proxy/응답 호환). 변환은 repo 내부에서 수행.
// 안전성: 단일 트랜잭션으로 신규 테이블 INSERT → DROP/RENAME 수행. 인덱스도 함께 재생성.
//        strftime('%s', ts) 가 NULL 을 반환하는 비정상 행은 0(epoch) 으로 폴백되어 prune 대상이 된다.
{
  type ColInfo = { name: string; type: string };
  const cols = db.pragma('table_info(optimization_events)') as ColInfo[];
  const tsCol = cols.find((c) => c.name === 'ts');
  if (tsCol && tsCol.type.toUpperCase() === 'TEXT') {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE optimization_events_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          ts           INTEGER NOT NULL,
          event_type   TEXT NOT NULL,
          host         TEXT NOT NULL,
          url_hash     TEXT NOT NULL,
          url          TEXT NOT NULL,
          decision     TEXT NOT NULL,
          orig_size    INTEGER,
          out_size     INTEGER,
          range_header TEXT,
          content_type TEXT,
          elapsed_ms   INTEGER NOT NULL
        );
        INSERT INTO optimization_events_new
          (id, ts, event_type, host, url_hash, url, decision, orig_size, out_size, range_header, content_type, elapsed_ms)
        SELECT id,
               COALESCE(CAST(strftime('%s', ts) AS INTEGER), 0),
               event_type, host, url_hash, url, decision, orig_size, out_size, range_header, content_type, elapsed_ms
        FROM optimization_events;
        DROP INDEX IF EXISTS idx_opt_events_host_ts;
        DROP INDEX IF EXISTS idx_opt_events_type_decision;
        DROP INDEX IF EXISTS idx_opt_events_ts;
        DROP INDEX IF EXISTS idx_opt_events_type_ts;
        DROP TABLE optimization_events;
        ALTER TABLE optimization_events_new RENAME TO optimization_events;
        CREATE INDEX IF NOT EXISTS idx_opt_events_host_ts       ON optimization_events(host, ts);
        CREATE INDEX IF NOT EXISTS idx_opt_events_type_decision ON optimization_events(event_type, decision);
        CREATE INDEX IF NOT EXISTS idx_opt_events_ts            ON optimization_events(ts);
        CREATE INDEX IF NOT EXISTS idx_opt_events_type_ts       ON optimization_events(event_type, ts);
      `);
    });
    tx();
  }
}

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

// users.username COLLATE NOCASE 마이그레이션 — 이슈 #340
// USER_SCHEMA 가 CREATE TABLE IF NOT EXISTS 라 기존 DB 의 users 테이블은 새 정의로
// 자동 변경되지 않는다. table_info 의 username 컬럼에 COLLATE NOCASE 가 부여되어
// 있는지 확인하고, 없다면 테이블을 재생성하여 collation 을 적용한다.
//
// 충돌 처리 정책: 직전의 #190 마이그레이션이 이미 lower-case 정규화 + 충돌 행에
// `__dup_<id>__` prefix 를 붙였기 때문에, 정상적인 운영 데이터에는 case-insensitive
// 중복이 남아있지 않다. 그래도 안전망으로 남아있는 NOCASE 중복을 다시 한 번 검출하여,
// 발견되면 동일 정책(활성/낮은 id keeper, 나머지 disable + __dup_ prefix)으로 정리한 뒤
// 재생성을 진행한다.
{
  type ColInfo = { name: string; type: string; pk: number; notnull: number; dflt_value: unknown };
  const cols = db.pragma('table_info(users)') as ColInfo[];
  const usernameCol = cols.find((c) => c.name === 'username');
  if (usernameCol) {
    // sqlite_master 의 SQL 문에서 username 정의에 COLLATE NOCASE 가 있는지 확인
    const masterRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
      .get() as { sql: string } | undefined;
    const hasNoCase = masterRow ? /username[^,]*COLLATE\s+NOCASE/i.test(masterRow.sql) : false;
    if (!hasNoCase) {
      type DupRow = { id: number; username: string; disabled_at: string | null };
      const rows = db.prepare('SELECT id, username, disabled_at FROM users').all() as DupRow[];
      const groups = new Map<string, DupRow[]>();
      for (const r of rows) {
        const k = r.username.trim().toLowerCase();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        // 1) NOCASE 중복 잔여 정리 — #190 이후에도 손으로 들어온 행이 있을 수 있어 안전망.
        for (const list of groups.values()) {
          if (list.length <= 1) continue;
          list.sort((a, b) => {
            const aActive = a.disabled_at === null ? 0 : 1;
            const bActive = b.disabled_at === null ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            return a.id - b.id;
          });
          const [, ...losers] = list;
          for (const loser of losers) {
            if (loser.disabled_at === null) {
              db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?')
                .run(now, now, loser.id);
            }
            if (!loser.username.startsWith('__dup_')) {
              db.prepare('UPDATE users SET username = ? WHERE id = ?')
                .run(`__dup_${loser.id}__${loser.username}`, loser.id);
            }
          }
        }

        // 2) 새 스키마로 테이블 재생성 후 데이터 복사. 컬럼 구성은 USER_SCHEMA 와 동일하게 유지.
        //    #377 — *_at 은 INTEGER unix-sec. 기존 TEXT ISO 값은 strftime('%s', ...) 로 변환한다.
        db.exec(`
          CREATE TABLE users_new (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            password_hash  TEXT    NOT NULL,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL,
            disabled_at    INTEGER,
            last_login_at  INTEGER,
            token_version  INTEGER NOT NULL DEFAULT 0
          );
        `);
        db.exec(`
          INSERT INTO users_new (id, username, password_hash, created_at, updated_at, disabled_at, last_login_at)
          SELECT id, username, password_hash,
                 COALESCE(CAST(strftime('%s', created_at) AS INTEGER), 0),
                 COALESCE(CAST(strftime('%s', updated_at) AS INTEGER), 0),
                 CASE WHEN disabled_at IS NULL THEN NULL ELSE CAST(strftime('%s', disabled_at) AS INTEGER) END,
                 CASE WHEN last_login_at IS NULL THEN NULL ELSE CAST(strftime('%s', last_login_at) AS INTEGER) END
          FROM users;
        `);
        db.exec('DROP INDEX IF EXISTS idx_users_username');
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_new RENAME TO users');
        db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
      });
      tx();
    }
  }
}

// users.token_version 컬럼 마이그레이션 — 이슈 #330/#331
// 무엇을: 기존 DB 의 users 테이블에 token_version 컬럼이 없으면 추가한다 (NOT NULL DEFAULT 0).
// 왜: 비활성화·비밀번호 재설정 후에도 기존 JWT 세션이 TTL(1시간)까지 유효하던 보안 결함 해소.
//     requireAuth 가 매 요청마다 DB token_version 과 JWT tv claim 을 비교해 즉시 무효화한다.
// 배포 영향(의도된 동작): 배포 시점에 유통 중이던 기존 JWT 는 tv claim 자체가 없으므로
//     `user.token_version(0) !== claims.tv(undefined)` 평가가 참이 되어 401 로 끊긴다.
//     즉 모든 활성 관리자 세션이 즉시 강제 로그아웃되며, 재로그인 시 새 토큰은 tv=0 으로
//     서명되어 정상 통과한다. 보안 수정의 본질상 받아들이는 비용. ADD COLUMN 자체는
//     SQLite 에서 O(1) 메타데이터 변경.
{
  type ColInfo = { name: string };
  const cols = db.pragma('table_info(users)') as ColInfo[];
  if (!cols.some((c) => c.name === 'token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
}

// users.*_at 타임스탬프 형식 마이그레이션 — 이슈 #377
// 무엇을: created_at/updated_at/disabled_at/last_login_at 컬럼이 TEXT 라면 INTEGER unix-sec 로 재생성.
// 왜: docs/architecture.md §6-2 Timestamp 규약 (DB = INTEGER unix-sec 단일 형식).
//    NOCASE 재생성(#340) 이후 신규 DB 는 INTEGER 로 만들어지지만, 이미 NOCASE 가 적용된
//    기존 운영 DB 는 *_at 만 TEXT 로 남는 케이스가 있어 별도 detect 후 강제 변환한다.
//    token_version ADD COLUMN(#330/#331) 이 먼저 수행되어 SELECT token_version 이 안전하다.
// 안전성: TEXT → INTEGER 단일 트랜잭션. strftime 변환 실패 행은 0(epoch) 으로 폴백.
{
  type ColInfoT = { name: string; type: string };
  const cols377 = db.pragma('table_info(users)') as ColInfoT[];
  const createdAtCol = cols377.find((c) => c.name === 'created_at');
  if (createdAtCol && createdAtCol.type.toUpperCase() === 'TEXT') {
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          password_hash  TEXT    NOT NULL,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL,
          disabled_at    INTEGER,
          last_login_at  INTEGER,
          token_version  INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO users_new (id, username, password_hash, created_at, updated_at, disabled_at, last_login_at, token_version)
        SELECT id, username, password_hash,
               COALESCE(CAST(strftime('%s', created_at) AS INTEGER), 0),
               COALESCE(CAST(strftime('%s', updated_at) AS INTEGER), 0),
               CASE WHEN disabled_at IS NULL THEN NULL ELSE CAST(strftime('%s', disabled_at) AS INTEGER) END,
               CASE WHEN last_login_at IS NULL THEN NULL ELSE CAST(strftime('%s', last_login_at) AS INTEGER) END,
               token_version
        FROM users;
        DROP INDEX IF EXISTS idx_users_username;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
      `);
    });
    tx();
  }
}

// 외래 키 제약 활성화 — 도메인 삭제 시 cascade 동작에 필요
db.pragma('foreign_keys = ON');

const domainRepo = new DomainRepository(db);
const dnsMetricsRepo = new DnsMetricsRepository(db);
const userRepo = new UserRepository(db);

// Rust 프록시 기본 도메인 시드 — 없으면 삽입, 있으면 무시 (#375)
// upsert 는 ON CONFLICT DO UPDATE 라 매 부팅마다 사용자 편집 origin/description/updated_at 을
// 덮어쓰던 회귀가 있었다. seedIfMissing 은 ON CONFLICT DO NOTHING 으로 기존 행을 보존한다.
domainRepo.seedIfMissing('httpbin.org', 'https://httpbin.org');

// 이슈 #366 — 구조화 로그.
// - genReqId: 매 요청에 req.id 부여 (Fastify 기본 increment + crypto random fallback).
// - requestIdHeader: 'x-request-id' 가 외부에서 들어오면 그대로 채택(트레이싱 체인), 응답에도 동일 헤더 에코.
// - LOG_LEVEL / LOG_PRETTY 환경변수로 운영(JSON info) ↔ 개발(pretty debug) 분리.
const logLevel = process.env.LOG_LEVEL ?? 'info';
const useLogPretty = process.env.LOG_PRETTY === 'true';
const app = Fastify({
  logger: useLogPretty
    ? { level: logLevel, transport: { target: 'pino-pretty' } }
    : { level: logLevel },
  // 외부 x-request-id 우선 채택. 없으면 Fastify 가 자체 ID 생성.
  requestIdHeader: 'x-request-id',
  // X-Request-Id 응답 헤더 노출 — 클라이언트가 같은 요청 로그를 찾을 수 있게.
  disableRequestLogging: false,
});

// 응답 헤더에 x-request-id 에코 — 클라이언트가 trace 가능 (#366)
app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', String(req.id));
});

// 표준 access log — onResponse 훅에서 단일 라인 출력 (#366).
// url_template 은 routeOptions.url 로 path param 정규화 (/api/domains/:host 형태).
// status/duration_ms/route_kind 라벨 표준화하여 카테고리별 집계 가능.
app.addHook('onResponse', async (req, reply) => {
  const url = req.url;
  const routeKind: 'public' | 'auth' | 'internal' =
    url.startsWith('/internal/') ? 'internal'
    : url.startsWith('/api/auth/') ? 'auth'
    :                                'public';
  req.log.info({
    req_id:        req.id,
    method:        req.method,
    url_template:  req.routeOptions?.url ?? url,
    url,
    status:        reply.statusCode,
    duration_ms:   Math.round(reply.elapsedTime),
    user_id:       req.user?.sub,
    route_kind:    routeKind,
  }, 'access');
});

// 쿠키 플러그인은 인증 훅이 req.cookies 를 읽으므로 훅 등록 이전에 register.
await app.register(cookie);

// rate-limit 플러그인 — global: false 로 등록해 라우트별 개별 설정만 동작하도록 한다.
// 전역 적용 시 SSE 스트림·내부 서비스간 호출·헬스체크 등이 제한될 수 있어 명시적 opt-in 방식 채택.
// 주의: 리버스 프록시(nginx) 뒤 배포 시 실제 클라이언트 IP를 얻으려면 trustProxy 설정 필요.
//
// errorResponseBuilder — 표준 에러 envelope({ error, message }) 강제 (#327, #416).
// 기본 응답은 raw Fastify shape({statusCode, error: "Too Many Requests", message}) 으로
// `error` 필드가 사람 친화 문자열이라 admin-web parseApiError 가 머신 코드로 분기 불가.
//
// Error 인스턴스를 throw 하도록 builder 를 작성한다. 그러면 setErrorHandler
// (error-handlers.ts) 가 catch 해서 err.code → envelope.error 로 매핑하고
// raw Fastify shape 의 추가 필드(statusCode/error="Too Many Requests")는 제거된다.
// Retry-After / x-ratelimit-* 헤더는 플러그인이 자동 부착.
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: (_req, ctx) => {
    const err = new Error(`요청이 너무 잦습니다. ${ctx.after} 후 다시 시도하세요.`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 429;
    err.code = 'rate_limit_exceeded';
    return err;
  },
});

// preHandler 훅 — 등록 순서가 실행 순서. 토큰 검사를 먼저 수행해
// /internal/* 의 인증 실패가 즉시 401 로 끊기도록 한다.
app.addHook('preHandler', requireInternalToken);
app.addHook('preHandler', createRequireAuth(userRepo));

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
app.decorate('optimizationEventsRepo', new OptimizationEventsRepository(db));
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

/** 헬스체크 엔드포인트 — 이슈 #369
 *
 * - /api/health      : backward-compat (live 와 동일 응답). 외부 도구 호환 유지.
 * - /api/health/live : liveness — 프로세스/이벤트 루프 살아있음만 확인. 인증 없음.
 * - /api/health/ready: readiness — SQLite + 다운스트림 critical 서비스 가용성까지 검증.
 *                       하나라도 실패 시 503, 응답 본문에 각 체크 결과 포함.
 *
 * 오케스트레이터(Docker/k8s) health probe 호환 — 모두 인증 우회 (require-auth.ts 화이트리스트).
 */
app.get('/api/health', async () => {
  return { status: 'ok' };
});

app.get('/api/health/live', async () => {
  return { status: 'ok' };
});

app.get('/api/health/ready', async (_req, reply) => {
  // 1) SQLite 즉시 응답 검증 — `SELECT 1`
  let dbOk = false;
  let dbError: string | null = null;
  try {
    const r = db.prepare('SELECT 1 AS one').get() as { one: number } | undefined;
    dbOk = r?.one === 1;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  // 2) Downstream critical 서비스 가용성 — HealthMonitor 캐시 (5초 stale 허용)
  //    proxy/storage/tls/dns 4종을 critical 로 분류. optimizer 는 콘텐츠 최적화 전용이라
  //    다운되어도 캐시 패스스루는 동작하므로 ready 판정에 포함하지 않는다.
  const sys = app.healthMonitor.getSystemStatus();
  const services = {
    proxy:   sys.proxy.online,
    storage: sys.storage.online,
    tls:     sys.tls.online,
    dns:     sys.dns.online,
    optimizer: sys.optimizer.online, // 정보용 — ready 판정 제외
  };
  const criticalReady = services.proxy && services.storage && services.tls && services.dns;

  const ready = dbOk && criticalReady;
  const body = {
    status: ready ? 'ready' : 'not_ready',
    checks: {
      db: { ok: dbOk, error: dbError },
      services,
    },
  };
  return reply.status(ready ? 200 : 503).send(body);
});

// 에러 응답 envelope 통일 (#175) — not-found / schema validation / 미잡힌 throw 정규화.
// Fastify v5 의 setErrorHandler 는 이후 등록되는 라우트에 적용되므로 라우트 register 호출
// **이전** 에 등록한다 (#416 — rate-limit Error throw 가 envelope 으로 변환되도록).
registerErrorHandlers(app);

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

/** URL 진단 fan-in API 라우트 등록 (#387) */
await app.register(diagnoseRoutes);

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
  // 이슈 #367 — TLS 인증서 만료 임박 사전 알림 스캐너. 기본 6시간 (TLS_SCAN_INTERVAL_MS).
  // sink: LogSink 기본, TLS_ALERT_WEBHOOK_URL 설정 시 WebhookSink 추가.
  startTlsExpiryScanner({
    db,
    tlsClient,
    sinks: createSinksFromEnv(app.log),
    log: app.log,
  });
  // 이슈 #368 — SQLite 유지보수: 1시간 주기 WAL checkpoint + 매일 새벽 4시 VACUUM INTO 백업 + 7일 보관.
  // dbDir 기준으로 backups/ 하위에 admin-YYYYMMDD-HHmmss.db 산출. MAINTENANCE_HOUR / BACKUP_RETENTION_DAYS 로 조정.
  startSqliteMaintenance({
    db,
    dbDir: path.dirname(dbPath),
    log: app.log,
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
