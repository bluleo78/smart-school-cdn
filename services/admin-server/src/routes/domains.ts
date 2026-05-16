/// 도메인 관리 API 라우트
/// Admin Server가 도메인의 소유자 — 변경 시 Proxy admin API(8081) + tls/dns gRPC 서비스에 전체 목록 push
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import type { DomainRepository } from '../db/domain-repo.js';
import { DomainStatsRepository } from '../db/domain-stats-repo.js';
import type { StatsPeriod } from '../db/domain-stats-repo.js';
import { OptimizationEventsRepository } from '../db/optimization-events-repo.js';
import { ALLOWED_DECISIONS } from './optimization-events.js';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';

/**
 * Proxy admin API(/requests)에서 in-memory 링버퍼 로그를 가져와 host/기간/상태/캐시/검색 필터와
 * limit/offset을 적용해 반환한다. `access_logs` SQLite 테이블이 존재하지 않을 때의 폴백 경로.
 *
 * 주의: proxy 링버퍼는 최대 100건만 유지(services/proxy/src/state.rs MAX_REQUEST_LOGS)하며
 * 재시작 시 휘발한다. DB 영속화는 Phase 18 후보로 별도 설계 예정.
 */
interface ProxyLogFilters {
  host: string;
  since?: number;       // unix seconds inclusive
  until?: number;       // unix seconds inclusive
  status?: string;      // '4xx' | '5xx'
  cache?: string;       // 'hit' | 'miss'
  q?: string;           // path substring
  limit: number;
  offset: number;
}

/**
 * LIKE 패턴에서 SQL 와일드카드 문자를 이스케이프한다.
 * `%`, `_`, `\` 를 `\` 로 이스케이프하여 리터럴 문자열 검색이 되도록 한다.
 * SQL 쿼리에서는 반드시 `ESCAPE '\'` 절과 함께 사용해야 한다.
 */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

interface DomainLogRow {
  timestamp: number;    // unix seconds — 기존 access_logs 스키마와 동일 형태
  status_code: number;
  cache_status: string;
  path: string;
  size: number;
}

async function fetchProxyLogs(filters: ProxyLogFilters): Promise<DomainLogRow[]> {
  interface ProxyRequestLog {
    method: string;
    host: string;
    url: string;
    status_code: number;
    response_time_ms: number;
    timestamp: string;   // ISO8601
    cache_status: string;
    size?: number;       // 응답 전송 바이트 (구 proxy 버전 호환 위해 optional)
  }

  let raw: ProxyRequestLog[];
  try {
    const res = await axios.get<ProxyRequestLog[]>(`${PROXY_ADMIN_URL}/requests`, { timeout: 3000 });
    raw = Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }

  const result: DomainLogRow[] = [];
  for (const r of raw) {
    if (r.host !== filters.host) continue;
    const tsSec = Math.floor(new Date(r.timestamp).getTime() / 1000);
    if (Number.isNaN(tsSec)) continue;
    if (filters.since !== undefined && tsSec < filters.since) continue;
    if (filters.until !== undefined && tsSec > filters.until) continue;
    if (filters.status === '5xx' && r.status_code < 500) continue;
    if (filters.status === '4xx' && !(r.status_code >= 400 && r.status_code < 500)) continue;
    // 'error': 4xx + 5xx 통합 필터 — 클라이언트의 "에러만" 토글에서 사용
    if (filters.status === 'error' && r.status_code < 400) continue;
    if (filters.cache === 'hit' && r.cache_status.toUpperCase() !== 'HIT') continue;
    if (filters.cache === 'miss' && r.cache_status.toUpperCase() !== 'MISS') continue;

    // url은 path+query 형태 — 쿼리 제거해 path만 추출
    const path = r.url.split('?')[0] ?? r.url;
    if (filters.q && !path.includes(filters.q)) continue;

    result.push({
      timestamp: tsSec,
      status_code: r.status_code,
      cache_status: r.cache_status,
      path,
      size: typeof r.size === 'number' ? r.size : 0,
    });
  }

  // proxy는 이미 최신순 반환하지만 필터 후 순서 보장 위해 정렬
  result.sort((a, b) => b.timestamp - a.timestamp);
  return result.slice(filters.offset, filters.offset + filters.limit);
}

/** 현재 활성 도메인 목록을 Proxy admin API에 push (실패 시 false 반환) */
export async function syncToProxy(domainRepo: DomainRepository): Promise<boolean> {
  try {
    const domains = domainRepo.findAll({ enabled: true }).map(({ host, origin }) => ({ host, origin }));
    await axios.post(`${PROXY_ADMIN_URL}/domains`, { domains }, { timeout: 3000 });
    console.log(`[sync] Proxy에 도메인 ${domains.length}건 동기화 완료`);
    return true;
  } catch (err) {
    console.error('[sync] Proxy 도메인 동기화 실패:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * host 단위 직렬화 락 (#192)
 *
 * 무엇을: 동일 host에 대한 toggle/PUT/DELETE 요청을 직렬로 실행한다.
 * 왜: toggle 핸들러가 `toggleEnabled → await syncToProxy → if(!synced) toggleEnabled(롤백)`
 *     시퀀스를 직렬화하지 않아, 동시에 두 요청이 들어오면 사이에 다른 요청이 끼어들어
 *     enabled 값이 의도와 어긋나거나 롤백이 다른 요청 결과를 덮어쓰는 race가 발생한다.
 *
 * 구현: Map<host, Promise> 체인. 새 요청은 현재 체인 끝에 await로 줄 서고,
 *      자기 차례가 끝나면 Map에서 자기 promise를 제거한다 (메모리 leak 방지).
 *      프로세스 단일 인스턴스라는 admin-server 운영 전제하에 유효 (멀티 인스턴스가
 *      필요해지면 SQLite 단일 트랜잭션 또는 외부 분산 락으로 승격 필요).
 */
const hostLocks = new Map<string, Promise<unknown>>();
async function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostLocks.get(host) ?? Promise.resolve();
  // 이전 작업의 실패가 다음 대기자에게 전파되지 않도록 catch로 흡수
  const run = prev.catch(() => undefined).then(() => fn());
  hostLocks.set(host, run);
  try {
    return await run;
  } finally {
    // 가장 마지막 등록된 promise가 자신일 때만 정리 (그 사이 다음 요청이 set했으면 보존)
    if (hostLocks.get(host) === run) hostLocks.delete(host);
  }
}

/** gRPC 팬아웃 — tls-service + dns-service에 전체 도메인 목록 push */
async function fanOutGrpc(
  app: FastifyInstance,
  domainRepo: DomainRepository,
): Promise<void> {
  const domains = domainRepo.findAll().map(d => ({ host: d.host, origin: d.origin }));
  const results = await Promise.allSettled([
    app.tlsClient.syncDomains(domains),
    app.dnsClient.syncDomains(domains),
  ]);
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const svc = i === 0 ? 'tls-service' : 'dns-service';
      app.log.warn({ err: result.reason }, `${svc} 도메인 동기화 실패`);
    }
  }
}

export async function domainRoutes(
  app: FastifyInstance,
  { domainRepo }: { domainRepo: DomainRepository },
) {
  // DomainRepository.database getter를 통해 DB 인스턴스에 안전하게 접근
  const statsRepo = new DomainStatsRepository(domainRepo.database);

  /**
   * 전체 도메인 목록 조회 — q/enabled/sort/order/limit/offset 쿼리 파라미터 지원
   *
   * 페이지네이션(#199):
   * - limit/offset 미지정 시 기존과 동일하게 전체 도메인 배열을 반환 (admin-web 호환)
   * - limit/offset 지정 시 음수/NaN은 무시하고 양의 정수만 적용 (silent ignore 방지)
   * - 응답 형태는 기존과 동일한 Domain[] 배열을 유지하여 클라이언트 호환성 보존
   *
   * 쿼리 파라미터 strict 검증 (#295):
   * - enabled: 'true|false|1|0|yes|no'(대소문자 무시) 만 허용. 그 외 값은 silent하게 false로
   *   강제되지 않고 400으로 명시 거부 — 클라이언트가 보낸 값과 응답 의미의 어긋남을 차단.
   * - sort: SORT_ALLOWED 화이트리스트만 허용. 그 외 400. (repo의 화이트리스트 fallback은 유지해 다중 방어)
   * - 기본값 적용 시점은 repo가 책임 — 라우트는 입력의 유효성만 검증.
   */
  // enabled 쿼리 파라미터 화이트리스트 — 명시적 표현만 허용하고 그 외는 400 (#295)
  const ENABLED_TRUE_VALUES  = new Set(['true', '1', 'yes']);
  const ENABLED_FALSE_VALUES = new Set(['false', '0', 'no']);
  // sort 쿼리 파라미터 화이트리스트 — repo SORT_WHITELIST와 일치 유지 (#295)
  const SORT_ALLOWED  = new Set(['host', 'created_at', 'updated_at']);
  // order 쿼리 파라미터 화이트리스트 — 'asc' | 'desc' 만 허용 (#295)
  const ORDER_ALLOWED = new Set(['asc', 'desc']);
  // q 검색어 최대 길이 — UI 검색 박스 한도와 동일하게 잡아 비정상적 입력을 사전 차단 (#295)
  const Q_MAX_LENGTH = 200;

  app.get<{
    Querystring: { q?: string; enabled?: string; sort?: string; order?: string; limit?: string; offset?: string };
  }>(
    '/api/domains',
    async (request, reply) => {
      const { q, enabled, sort, order } = request.query;
      // enabled strict 검증 (#295) — 빈 문자열·'foo'·'2'·'null' 등은 silent false 변환 대신 400
      let enabledFilter: boolean | undefined;
      if (enabled !== undefined) {
        const normalized = enabled.toLowerCase();
        if (ENABLED_TRUE_VALUES.has(normalized)) {
          enabledFilter = true;
        } else if (ENABLED_FALSE_VALUES.has(normalized)) {
          enabledFilter = false;
        } else {
          // 표준 envelope (#329): 머신 코드는 `error`, 사람 표시 메시지는 `message`로 분리
          return reply.status(400).send({
            error: 'invalid_input',
            message: `enabled는 true|false|1|0|yes|no 중 하나여야 합니다 (받은 값: "${enabled}").`,
          });
        }
      }
      // sort strict 검증 (#295) — 화이트리스트 외 값(예: 'invalid', 'DROP_TABLE')은 명시 거부
      if (sort !== undefined && !SORT_ALLOWED.has(sort)) {
        // 표준 envelope (#329)
        return reply.status(400).send({
          error: 'invalid_input',
          message: `sort는 host|created_at|updated_at 중 하나여야 합니다 (받은 값: "${sort}").`,
        });
      }
      // order strict 검증 (#295) — 'asc'|'desc' 외 값은 명시 거부 (대소문자 무시)
      if (order !== undefined && !ORDER_ALLOWED.has(order.toLowerCase())) {
        // 표준 envelope (#329)
        return reply.status(400).send({
          error: 'invalid_input',
          message: `order는 asc|desc 중 하나여야 합니다 (받은 값: "${order}").`,
        });
      }
      // q 길이 가드 (#295) — UI 검색박스 maxLength와 정합. 비정상적 폭주 입력 차단.
      if (q !== undefined && q.length > Q_MAX_LENGTH) {
        // 표준 envelope (#329)
        return reply.status(400).send({
          error: 'invalid_input',
          message: `q는 ${Q_MAX_LENGTH}자 이하여야 합니다 (받은 길이: ${q.length}).`,
        });
      }
      // limit/offset strict 검증 (#415) — 기존엔 NaN/음수/0 을 undefined 로 silent 변환해 페이지네이션이
      // 의도와 다르게 미적용됐다. #408 정책(invalid_<param> 400)에 맞춰 빈 문자열 외 비정상 값은 400.
      const limitRaw = request.query.limit;
      let limit: number | undefined;
      if (limitRaw !== undefined && limitRaw !== '') {
        const parsed = z.coerce.number().int().min(1).safeParse(limitRaw);
        if (!parsed.success) {
          return reply.status(400).send({
            error: 'invalid_input',
            message: `limit must be a positive integer (received: "${limitRaw}")`,
            issues: parsed.error.issues,
          });
        }
        limit = parsed.data;
      }
      const offsetRaw = request.query.offset;
      let offset: number | undefined;
      if (offsetRaw !== undefined && offsetRaw !== '') {
        const parsed = z.coerce.number().int().min(0).safeParse(offsetRaw);
        if (!parsed.success) {
          return reply.status(400).send({
            error: 'invalid_input',
            message: `offset must be a non-negative integer (received: "${offsetRaw}")`,
            issues: parsed.error.issues,
          });
        }
        offset = parsed.data;
      }
      return domainRepo.findAll({
        q,
        enabled: enabledFilter,
        sort,
        order,
        limit,
        offset,
      });
    },
  );

  // NOTE: /summary, /bulk는 /:host 보다 먼저 등록해야 'summary'/'bulk'가 :host로 매칭되지 않음

  /** 전체 도메인 요약 통계 (카드용) — 프론트엔드 DomainSummary 타입에 맞게 집계 */
  app.get('/api/domains/summary', async () => {
    const allDomains = domainRepo.findAll();
    const total = allDomains.length;
    const enabled = allDomains.filter((d) => d.enabled === 1).length;
    const disabled = total - enabled;

    // 전체 도메인의 per-host 통계를 집계하여 단일 요약 객체로 변환
    const perHost = statsRepo.getSummaryAll();
    const todayRequests = perHost.reduce((s, r) => s + r.today_requests, 0);
    const todayCacheHits = perHost.reduce((s, r) => s + r.today_cache_hits, 0);
    const todayBandwidth = perHost.reduce((s, r) => s + r.today_bandwidth, 0);
    const cacheHitRate = todayRequests > 0 ? todayCacheHits / todayRequests : 0;

    // hourly: 전체 도메인의 시간별 요청·캐시 히트·대역폭 합산 (최대 24개 버킷)
    // — sparkline 3종을 같은 인덱스(=같은 시간 버킷) 정렬로 합산해 KPI 카드 3종이 동일 시간축을 공유하도록 한다.
    const maxBuckets = 24;
    const hourlyRequests = Array<number>(maxBuckets).fill(0);
    const hourlyCacheHits = Array<number>(maxBuckets).fill(0);
    const hourlyBandwidth = Array<number>(maxBuckets).fill(0);
    for (const r of perHost) {
      // host별 hourly 배열은 동일 길이·동일 인덱스가 동일 시간 버킷을 가리킨다 (domain-stats-repo의 push 순서 보존).
      const buckets = r.hourly.slice(-maxBuckets);
      const cacheBuckets = r.hourly_cache_hits.slice(-maxBuckets);
      const bwBuckets = r.hourly_bandwidth.slice(-maxBuckets);
      const offset = maxBuckets - buckets.length;
      for (let i = 0; i < buckets.length; i++) {
        hourlyRequests[offset + i] += buckets[i];
        hourlyCacheHits[offset + i] += cacheBuckets[i] ?? 0;
        hourlyBandwidth[offset + i] += bwBuckets[i] ?? 0;
      }
    }

    // 시간대별 캐시 히트율 = cache_hits / requests (요청 0 버킷은 0으로 — divide-by-zero 가드)
    const hourlyCacheHitRate = hourlyRequests.map((req, i) =>
      req > 0 ? hourlyCacheHits[i] / req : 0,
    );

    // perHost에서 delta 집계 — 전체 도메인의 평균 변화율
    const totalTodayRequestsDelta = perHost.length > 0
      ? perHost.reduce((sum, r) => sum + r.today_requests_delta, 0) / perHost.length
      : 0;
    const totalHitRateDelta = perHost.length > 0
      ? perHost.reduce((sum, r) => sum + r.hit_rate_delta, 0) / perHost.length
      : 0;

    // TLS 만료 임박(30일 이내) 도메인을 alerts에 포함 — tls-service 장애 시에도 summary는 정상 반환
    const TLS_ALERT_WINDOW_MS = 30 * 86_400_000;
    const now = Date.now();
    let tlsAlerts: Array<{ type: 'tls_expiring'; host: string; expiresAt: string }> = [];
    try {
      const { certs } = await app.tlsClient.listCertificates();
      tlsAlerts = certs
        .filter((cert) => {
          const expiresMs = new Date(cert.expires_at).getTime();
          // 만료된 인증서는 제외하고, 아직 유효하지만 30일 이내 만료 예정인 것만 포함
          return expiresMs > now && (expiresMs - now) < TLS_ALERT_WINDOW_MS;
        })
        .map((cert) => ({ type: 'tls_expiring' as const, host: cert.domain, expiresAt: cert.expires_at }));
    } catch (err) {
      // tls-service 연결 실패는 경고만 남기고 alerts는 빈 배열로 graceful degradation
      app.log.warn({ err }, '[summary] tls-service listCertificates 실패 — alerts 빈 배열로 대체');
    }

    return {
      total,
      enabled,
      disabled,
      todayRequests,
      todayRequestsDelta: Math.round(totalTodayRequestsDelta * 10) / 10,
      cacheHitRate,
      cacheHitRateDelta: Math.round(totalHitRateDelta * 10) / 10,
      todayBandwidth,
      hourlyRequests,
      hourlyCacheHitRate,
      hourlyBandwidth,
      alerts: tlsAlerts,
    };
  });

  /**
   * RFC-1123 도메인명 검증 정규식 — bulk/단일 추가 양쪽에서 공유
   * - 와일드카드(*.sub.domain.com) 허용
   * - 각 레이블은 영문자·숫자·하이픈으로 구성, 하이픈으로 시작/끝 불가
   * - XSS 페이로드(<script> 등) 및 특수문자 차단
   */
  const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

  /**
   * origin URL 최대 길이 — browser de facto URL 한도(2083)보다 짧게 잡아
   * UI 노출/로그 폭주를 방지한다. 일반적인 origin은 수십 바이트 수준.
   */
  const ORIGIN_MAX_LENGTH = 2083;

  /**
   * origin URL 형식 검증 — POST(/api/domains), POST(/api/domains/bulk),
   * PUT(/api/domains/:host) 세 곳에서 공유 (#167).
   *
   * 검증 항목:
   * - 문자열이고 ORIGIN_MAX_LENGTH 이하 길이
   * - URL 생성자로 파싱 가능 (공백·잘못된 인코딩 거부)
   * - protocol이 `http:` 또는 `https:` (javascript:/file:/ftp: 차단 — #42)
   * - hostname이 비어 있지 않음 (`http://`, `http:///` 같은 빈 host 거부)
   * - 입력 문자열에 공백/탭/개행이 없음 (URL 파서가 일부 공백을 관대하게 처리해
   *   `http://exa mple.com` 같이 host 중간 공백이 통과하는 케이스 방지)
   */
  function isValidOrigin(origin: unknown): origin is string {
    if (typeof origin !== 'string') return false;
    if (origin.length === 0 || origin.length > ORIGIN_MAX_LENGTH) return false;
    // 공백/탭/개행이 origin 어디에 있든 즉시 거부 — `http://exa mple.com`, `http://   ` 등 차단
    if (/\s/.test(origin)) return false;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!url.hostname) return false;
    // path/query/fragment 거부 — origin URL 은 scheme+host[+port] 만 의미가 있다.
    // proxy 가 upstream 에 path 를 그대로 prefix 하지 않게 막아 잘못된 라우팅을 방지한다 (#191).
    // `new URL()` 은 path 가 없으면 pathname 을 '/' 로 자동 채우므로 '/' 만 허용 처리한다.
    if (url.pathname !== '' && url.pathname !== '/') return false;
    if (url.search !== '') return false;
    if (url.hash !== '') return false;
    return true;
  }

  /**
   * origin URL 정규화 — 검증을 통과한 입력을 표준 형태(`scheme://host[:port]`)로 환원.
   * trailing slash, host 대소문자, 자동 채워진 pathname '/' 가 다른 문자열로 저장되는 것을
   * 막아 동일 origin 이 두 번 저장되는 문제를 방지한다 (#191).
   *
   * `URL.origin` 은 hostname 을 자동 lowercase 처리하고 path/query/hash 를 포함하지 않는다.
   * 호출 전에 `isValidOrigin` 으로 검증된 입력을 가정하므로 여기서는 throw 하지 않는다.
   */
  function normalizeOrigin(origin: string): string {
    return new URL(origin).origin;
  }

  /**
   * host 입력 정규화 — DNS 호스트네임은 RFC 1035 §2.3.3에 의해 case-insensitive 이고
   * Proxy 캐시 키·라우팅도 lowercase 호스트를 가정한다. 같은 도메인이 대소문자만 다른
   * 별도 행으로 저장되는 것을 막기 위해 모든 입력 경계(POST 단건/bulk, PUT/GET/DELETE/toggle/sync/purge/통계)에서
   * `trim().toLowerCase()` 로 통일한다 (#190 username 정규화 패턴, #191 origin 정규화와 짝).
   *
   * 검증(`DOMAIN_RE`)은 정규화 후 수행해 `Example.COM` 같은 입력이 통과되도록 한다.
   * (DOMAIN_RE 자체는 /i 플래그라 검증은 통과하지만 저장은 lowercase 형태로만 일관 유지)
   */
  function normalizeHost(input: string): string {
    return input.trim().toLowerCase();
  }

  /** origin 검증 실패 시 표시할 공통 에러 메시지 — POST/PUT/bulk 공유 */
  const ORIGIN_INVALID_MSG = '유효한 origin URL이 아닙니다. (예: https://example.com, 최대 2083자)';

  /** 도메인 일괄 추가 — 성공한 각 도메인에 기본 최적화 프로파일 자동 생성 */
  app.post<{ Body: { domains?: Array<{ host: string; origin: string }> } }>(
    '/api/domains/bulk',
    async (request, reply) => {
      const rawBody = request.body ?? {};
      const domains = Array.isArray(rawBody.domains) ? rawBody.domains : undefined;
      if (!Array.isArray(domains) || domains.length === 0) {
        // 표준 envelope (#329)
        return reply.status(400).send({ error: 'invalid_input', message: 'domains 배열은 필수 항목입니다.' });
      }
      // (#255) 일괄 등록 상한 가드 — admin-web Textarea의 줄 수 상한과 일치시켜
      // 직접 API 호출이나 mock 우회로 거대한 배열이 들어오는 경우에도 동일하게 거부한다.
      // Fastify body-limit(1MB) 외 별도의 length 가드가 없어 long-running 트랜잭션 / 503 위험을 사전 차단.
      const BULK_MAX_DOMAINS = 500;
      if (domains.length > BULK_MAX_DOMAINS) {
        // 표준 envelope (#329)
        return reply.status(400).send({
          error: 'invalid_input',
          message: `한 번에 등록할 수 있는 도메인은 최대 ${BULK_MAX_DOMAINS}개입니다 (요청: ${domains.length}개).`,
        });
      }
      // host 정규화 (#201) — DNS case-insensitive. 정규화 후 검증/저장 모두 lowercase 입력으로 일관.
      // 입력값을 직접 mutate 하면 호출 측 객체에 영향이 가므로 새 배열을 만들고 이후 단계에 전달한다.
      const normalizedHostDomains = domains.map((d) => ({
        host: typeof d.host === 'string' ? normalizeHost(d.host) : d.host,
        origin: d.origin,
      }));
      // host 형식 검증 — RFC-1123 DOMAIN_RE 적용 (#152)
      // 단일 추가(/api/domains)와 동일한 검증을 적용하여 비정상 host가 DB에 저장되는 것을 방지
      for (const d of normalizedHostDomains) {
        if (typeof d.host !== 'string' || !DOMAIN_RE.test(d.host)) {
          // 표준 envelope (#329)
          return reply.status(400).send({
            error: 'domain_invalid_format',
            message: `유효한 도메인 형식이 아닙니다: "${d.host}"`,
          });
        }
      }
      // 동일 host 중복 줄 방어 (#225) — 클라이언트가 사전 검출하지만, 직접 API 호출 시
      // bulkInsert ON CONFLICT 가 첫 origin 만 저장하고 나머지를 "skipped(이미 존재)" 로 분류해
      // 사용자에게 잘못된 안내가 나가는 데이터 의도 손실을 막는다. 명시적 400 으로 거부.
      const seenHosts = new Set<string>();
      for (const d of normalizedHostDomains) {
        if (typeof d.host !== 'string') continue;
        if (seenHosts.has(d.host)) {
          // 표준 envelope (#329)
          return reply.status(400).send({
            error: 'duplicate_host',
            message: `중복된 host: ${d.host}. 한 번에는 같은 host를 한 번만 입력해 주세요.`,
          });
        }
        seenHosts.add(d.host);
      }
      // 각 도메인의 origin URL 형식 검증 — scheme/host/길이/공백 종합 검증 (#167)
      // javascript:, file://, ftp:// 등 비정상 scheme + `http://`(빈 host) + 5000자 + 공백 포함 host 모두 차단
      for (const d of normalizedHostDomains) {
        if (!isValidOrigin(d.origin)) {
          // 에러 메시지에 입력값 일부를 포함 — 5000자 폭주 방지 위해 80자로 잘라낸다
          const raw: unknown = d.origin;
          const preview = typeof raw === 'string' ? raw.slice(0, 80) : String(raw);
          // 표준 envelope (#329)
          return reply.status(400).send({
            error: 'origin_invalid',
            message: `${ORIGIN_INVALID_MSG} (입력: "${preview}")`,
          });
        }
      }
      // origin 정규화 — trailing slash/host 대소문자/path 자동 추가가 동일 origin 을
      // 다른 문자열로 저장하지 않도록 표준형(`URL.origin`)으로 통일한다 (#191).
      const normalizedDomains = normalizedHostDomains.map((d) => ({ host: d.host, origin: normalizeOrigin(d.origin) }));
      // (#197) bulkInsert 는 added/skipped/failed 를 분리 반환한다.
      // skipped: 이미 존재하는 host (origin 보존), failed: SQL 실패. 클라이언트는 added 만 신규 추가로 안내.
      const result = domainRepo.bulkInsert(normalizedDomains);
      const synced = await syncToProxy(domainRepo);
      if (!synced) {
        // 표준 envelope (#329) — `result`는 부분 진행 정보로 함께 전달
        return reply.status(502).send({ error: 'proxy_sync_failed', message: 'Proxy 동기화 실패', result });
      }
      await fanOutGrpc(app, domainRepo);
      // 신규 추가된 host 에만 기본 최적화 프로파일 생성 — skipped(기존 host) 는 이미 프로파일이 있다고 가정 (#197).
      // failed/skipped 를 제외한 added 도메인 host 만 추출.
      const skippedOrFailed = new Set<string>([
        ...result.failed.map((f) => f.host),
        ...result.skipped.map((s) => s.host),
      ]);
      const addedHosts = normalizedHostDomains.map((d) => d.host).filter((h): h is string => typeof h === 'string' && !skippedOrFailed.has(h));
      await Promise.allSettled(
        addedHosts.map(async (host) => {
          try {
            await app.optimizerClient.setProfile({ domain: host, quality: 85, max_width: 0, enabled: true });
          } catch (err) {
            app.log.warn({ err }, `[optimizer] 기본 프로파일 생성 실패: ${host}`);
          }
        }),
      );
      return reply.status(201).send(result);
    },
  );

  /** 도메인 일괄 삭제 */
  app.delete<{ Body: { hosts?: string[] } }>(
    '/api/domains/bulk',
    async (request, reply) => {
      const rawHosts = request.body?.hosts;
      if (!Array.isArray(rawHosts) || rawHosts.length === 0) {
        // 표준 envelope (#329)
        return reply.status(400).send({ error: 'invalid_input', message: 'hosts 배열은 필수 항목입니다.' });
      }
      // 비문자열 항목 사전 거부 (#310) — 과거에는 비문자열을 그대로 통과시켜 better-sqlite3
      // prepared statement 바인딩에서 raw "Too few parameter values were provided" 500 으로 크래시했다.
      // bulkInsert(POST /api/domains/bulk) 가 host 타입을 명시적으로 400 거부하는 패턴(#152)과 짝을 맞춰
      // 입력 경계에서 즉시 거부해 일관된 정책을 유지한다.
      const invalidHost = rawHosts.find((h) => typeof h !== 'string');
      if (invalidHost !== undefined) {
        // 표준 envelope (#329)
        return reply.status(400).send({ error: 'invalid_input', message: 'hosts 배열에는 문자열 host만 허용됩니다.' });
      }
      // host 정규화 (#201) — 같은 도메인의 대소문자 변형이 섞여 들어와도 일관되게 lowercase 키로 삭제.
      const hosts = (rawHosts as string[]).map((h) => normalizeHost(h));
      // (#312) 단건 DELETE(#311) 와 동일한 정책으로 bulk 도 트랜잭션으로 감싼다.
      // 기존 구현은 bulkDelete + optimization_events 정리를 트랜잭션 밖에서 즉시 수행한 뒤
      // syncToProxy 가 실패하면 502 만 반환하고 DB 롤백을 하지 않아, 사용자에겐 "실패" 가
      // 안내됐는데도 도메인/통계/이벤트가 영구 삭제되는 데이터 손실이 있었다.
      // BEGIN IMMEDIATE → bulkDelete + deleteByHosts(events) → await syncToProxy → 결과에
      // 따라 COMMIT/ROLLBACK 으로 감싸면 ROLLBACK 시 도메인 행, FK CASCADE 로 묶인
      // domain_stats, 그리고 같은 트랜잭션 안에서 삭제한 optimization_events 가 모두 원형 복원된다.
      const optEventsRepo = new OptimizationEventsRepository(domainRepo.database);
      const txResult = await domainRepo.runInTransactionAsync<{
        synced: boolean;
        deleted: number;
        missing: string[];
      }>(async () => {
        // (#212) 부분 실패 분리 안내를 위해 bulkDelete 가 deleted + missing 을 함께 반환하도록 확장.
        // missing 은 "요청에 포함되었으나 DB에 매칭되는 행이 없던 host" — 클라이언트에서 분리 토스트로 안내한다.
        const { deleted, missing } = domainRepo.bulkDelete(hosts);
        // (#185) optimization_events 는 FK 제약이 없어 CASCADE 가 동작하지 않으므로 명시적으로 정리.
        // 트랜잭션 안에서 함께 삭제 → ROLLBACK 시 자동 복원되어 도메인 복원 경로와 일관성 유지.
        optEventsRepo.deleteByHosts(hosts);
        // syncToProxy 는 같은 better-sqlite3 커넥션으로 SELECT 하므로 트랜잭션 내부의 미커밋
        // 상태(=해당 host 들이 빠진 목록)를 그대로 읽어 Proxy 에 보낸다. 실패 시 ROLLBACK.
        const synced = await syncToProxy(domainRepo);
        return { commit: synced, value: { synced, deleted, missing } };
      });
      if (!txResult.synced) {
        // 표준 envelope (#329)
        return reply.status(502).send({ error: 'proxy_sync_failed', message: 'Proxy 동기화 실패' });
      }
      await fanOutGrpc(app, domainRepo);
      // requested 는 사용자가 보낸 호스트 수(중복 포함 원본 길이) — 토스트의 "요청 N건 중 M건"의 N에 해당.
      return reply.status(200).send({
        deleted: txResult.deleted,
        requested: rawHosts.length,
        missing: txResult.missing,
      });
    },
  );

  /** 도메인 추가 (이미 있으면 origin 갱신) — 추가 성공 후 기본 최적화 프로파일 자동 생성 */
  app.post<{ Body: { host?: string; origin?: string } }>(
    '/api/domains',
    async (request, reply) => {
      const rawBody = request.body ?? {};
      // host 정규화 — DNS case-insensitive 규약에 맞춰 lowercase 통일 (#201).
      // 정규화 후에도 빈 문자열이면 필수값 누락으로 처리.
      const host = typeof rawBody.host === 'string' ? normalizeHost(rawBody.host) : rawBody.host;
      const origin = rawBody.origin;
      if (!host || !origin) {
        // 표준 envelope (#329)
        return reply.status(400).send({ error: 'invalid_input', message: 'host와 origin은 필수 항목입니다.' });
      }
      // host 형식 검증 — upsert 전에 수행하여 유효하지 않은 도메인이 DB에 저장되는 것을 방지
      if (!DOMAIN_RE.test(host)) {
        // 표준 envelope (#329)
        return reply.status(400).send({
          error: 'domain_invalid_format',
          message: '유효한 도메인 형식이 아닙니다. (예: example.com, *.sub.com)',
        });
      }
      // origin URL 종합 검증 — scheme/host/길이/공백 (#167)
      // PUT과 동일한 이중 방어 패턴 — javascript: 등 비정상 scheme + 빈 host + 과도 길이 + 공백 모두 차단
      if (!isValidOrigin(origin)) {
        // 표준 envelope (#329)
        return reply.status(400).send({ error: 'origin_invalid', message: ORIGIN_INVALID_MSG });
      }
      // origin 정규화 — `URL.origin` 으로 trailing slash/host casing 표준화 (#191)
      const normalizedOrigin = normalizeOrigin(origin);
      // (#363) bulk-delete(#312) / PUT(#151) / toggle(#151,#192) 와 동일하게 단건 POST 도
      // sync 실패 시 DB 상태를 롤백한다. 트랜잭션을 사용하지 않으면 사용자에게는 502 가 안내되는데도
      // (a) 신규 host 의 새 행, (b) 기존 host 의 origin 덮어쓰기가 그대로 영구 잔류해
      // 운영자 신뢰가 깨지고 라우팅 의도가 손상된다.
      // BEGIN IMMEDIATE 트랜잭션 안에서 upsert → await syncToProxy → 결과에 따라 COMMIT/ROLLBACK
      // 으로 감싸면 신규/기존 host 모두 원형 복원된다 (기존 행은 ROLLBACK 으로 origin/updated_at 복원,
      // 신규 행은 ROLLBACK 으로 INSERT 자체가 사라짐).
      const txResult = await domainRepo.runInTransactionAsync<{ synced: boolean }>(async () => {
        domainRepo.upsert(host, normalizedOrigin);
        const synced = await syncToProxy(domainRepo);
        return { commit: synced, value: { synced } };
      });
      if (!txResult.synced) {
        // 표준 envelope (#329) — 롤백 후이므로 `domain` 부분 진행 정보는 더 이상 의미가 없어 미포함.
        return reply.status(502).send({
          error: 'proxy_sync_failed',
          message: 'Proxy 동기화 실패',
        });
      }
      await fanOutGrpc(app, domainRepo);
      // 기본 최적화 프로파일 생성 — 실패해도 도메인 추가는 성공 처리
      try {
        await app.optimizerClient.setProfile({ domain: host, quality: 85, max_width: 0, enabled: true });
      } catch (err) {
        app.log.warn({ err }, `[optimizer] 기본 프로파일 생성 실패: ${host}`);
      }
      return reply.status(201).send(domainRepo.findByHost(host));
    },
  );

  /** 단일 도메인 상세 조회 */
  app.get<{ Params: { host: string } }>('/api/domains/:host', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    return domain;
  });

  /** 도메인 편집 (origin, enabled, description) */
  app.put<{
    Params: { host: string };
    // enabled는 0|1만 허용 — TypeScript 타입으로 좁혀 런타임 검증과 일관성 유지 (#156)
    Body: { origin?: string; enabled?: 0 | 1; description?: string };
  }>('/api/domains/:host', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    // (#192) host 단위 락으로 toggle과 직렬화 — PUT 중 toggle이 끼어들어 일관성이 깨지는 것을 방지
    return withHostLock(host, async () => {
    const { origin, enabled, description } = request.body ?? {};
    // origin이 전달되었는데 빈 문자열이면 400 — POST와 동일한 필수값 보장
    if (origin !== undefined && origin.trim() === '') {
      // 표준 envelope (#329)
      return reply.status(400).send({ error: 'invalid_input', message: 'origin은 빈 문자열로 저장할 수 없습니다.' });
    }
    // origin이 전달되었으면 종합 검증 — scheme/host/길이/공백 (#167)
    // 클라이언트·서버 이중 방어 — Proxy가 올바르게 업스트림에 연결하려면 hostname/scheme 모두 유효해야 함 (#103, #167)
    if (origin !== undefined && !isValidOrigin(origin)) {
      // 표준 envelope (#329)
      return reply.status(400).send({ error: 'origin_invalid', message: ORIGIN_INVALID_MSG });
    }
    // origin 정규화 — 검증 통과 시 표준형으로 변환 (#191).
    // origin 이 undefined 면 그대로 유지(부분 업데이트 의미 보존)하고, 정의되었을 때만 표준화.
    const normalizedOrigin = origin !== undefined ? normalizeOrigin(origin) : undefined;
    // enabled는 0 또는 1만 허용 — 임의 정수가 DB에 저장되면 UI가 상태를 오판한다 (#156)
    if (enabled !== undefined && enabled !== 0 && enabled !== 1) {
      // 표준 envelope (#329)
      return reply.status(400).send({ error: 'invalid_input', message: 'enabled는 0 또는 1이어야 합니다.' });
    }
    // description 최대 500자 — 무제한 저장 방지 (#155)
    if (description !== undefined && description.length > 500) {
      // 표준 envelope (#329)
      return reply.status(400).send({
        error: 'description_too_long',
        message: 'description은 500자 이하여야 합니다.',
      });
    }
    // 롤백을 위해 수정 전 원본 값을 먼저 저장한다
    const original = domainRepo.findByHost(host);
    if (!original) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    const updated = domainRepo.update(host, { origin: normalizedOrigin, enabled, description });
    if (!updated) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    const synced = await syncToProxy(domainRepo);
    if (!synced) {
      // Proxy 동기화 실패 시 DB를 원래 값으로 롤백 — toggle과 동일한 일관성 보장 (#151)
      domainRepo.update(host, {
        origin: original.origin,
        enabled: original.enabled,
        description: original.description,
      });
      // 표준 envelope (#329)
      return reply.status(502).send({ error: 'proxy_sync_failed', message: 'Proxy 동기화 실패' });
    }
    await fanOutGrpc(app, domainRepo);
    return updated;
    });
  });

  /**
   * 도메인 활성/비활성 토글 — 실패 시 롤백 + 502
   *
   * (#192) host 단위 락으로 toggle/PUT/DELETE를 직렬화. 동시 토글 시:
   * - 이전: toggle → await sync → 롤백 toggle 사이에 다른 요청이 끼어들어 enabled 값이 어긋남
   * - 이후: 같은 host 요청은 순차 실행되어 race 제거
   *
   * 또한 롤백을 `toggleEnabled` 재호출(invert)이 아닌 `update({enabled: original.enabled})`
   * 형태의 절대값 복원으로 변경 — 락이 없는 경계 케이스에서도 idempotent.
   */
  app.post<{ Params: { host: string } }>('/api/domains/:host/toggle', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    return withHostLock(host, async () => {
      // 롤백 시 절대값 복원을 위해 변경 전 enabled 값을 먼저 캡처
      const original = domainRepo.findByHost(host);
      if (!original) {
        return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
      }
      const toggled = domainRepo.toggleEnabled(host);
      if (!toggled) {
        return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
      }
      const synced = await syncToProxy(domainRepo);
      if (!synced) {
        // 롤백 — 절대값(원본 enabled)으로 복원하여 invert 누적 문제 방지 (#192)
        domainRepo.update(host, { enabled: original.enabled });
        // 표준 envelope (#329)
      return reply.status(502).send({ error: 'proxy_sync_failed', message: 'Proxy 동기화 실패' });
      }
      await fanOutGrpc(app, domainRepo);
      return toggled;
    });
  });

  /** 도메인 강제 동기화 — Proxy + TLS + DNS 서비스에 전체 목록 재전송 */
  app.post<{ Params: { host: string } }>('/api/domains/:host/sync', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }

    const results = { proxy: false, tls: false, dns: false };
    const proxyOk = await syncToProxy(domainRepo);
    results.proxy = proxyOk;
    try {
      const domains = domainRepo.findAll({ enabled: true }).map(d => ({ host: d.host, origin: d.origin }));
      await app.tlsClient.syncDomains(domains);
      results.tls = true;
    } catch { /* 실패 기록 */ }
    try {
      const domains = domainRepo.findAll({ enabled: true }).map(d => ({ host: d.host, origin: d.origin }));
      await app.dnsClient.syncDomains(domains);
      results.dns = true;
    } catch { /* 실패 기록 */ }

    const allOk = results.proxy && results.tls && results.dns;
    return reply.status(allOk ? 200 : 207).send(results);
  });

  /** 도메인 캐시 퍼지 — Proxy에 POST 요청 */
  app.post<{ Params: { host: string } }>('/api/domains/:host/purge', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    try {
      // Proxy는 /domains/{host}/purge 엔드포인트를 노출함 (올바른 URL 사용)
      await axios.post(`${PROXY_ADMIN_URL}/domains/${encodeURIComponent(host)}/purge`, {}, { timeout: 5000 });
      return reply.status(200).send({ ok: true });
    } catch (err) {
      // 표준 envelope (#329)
      return reply.status(502).send({
        error: 'proxy_purge_failed',
        message: 'Proxy 캐시 퍼지 실패',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** 단일 도메인 요약 통계 — L1/Edge/Bypass 비율 포함 (Overview 카드용) */
  app.get<{ Params: { host: string } }>(
    '/api/domains/:host/summary',
    async (request, reply) => {
      const host = normalizeHost(decodeURIComponent(request.params.host));
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
      }
      const summary = statsRepo.getSummaryForHost(host);
      return {
        host,
        today_requests:      summary?.today_requests      ?? 0,
        today_cache_hits:    summary?.today_cache_hits     ?? 0,
        today_bandwidth:     summary?.today_bandwidth      ?? 0,
        hit_rate:            summary?.hit_rate             ?? 0,
        today_l1_hit_rate:   summary?.today_l1_hit_rate    ?? 0,
        today_edge_hit_rate: summary?.today_edge_hit_rate  ?? 0,
        today_bypass_rate:   summary?.today_bypass_rate    ?? 0,
      };
    },
  );

  /** 도메인 통계 조회 (period: 1h | 24h | 7d | 30d | custom) */
  app.get<{
    Params: { host: string };
    Querystring: { period?: string; from?: string; to?: string };
  }>(
    '/api/domains/:host/stats',
    async (request, reply) => {
      const host = normalizeHost(decodeURIComponent(request.params.host));
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
      }
      const q = request.query;
      // 1h, custom 추가 — 기존 24h/7d/30d 동작 유지
      const validPeriods: StatsPeriod[] = ['1h', '24h', '7d', '30d', 'custom'];
      // #408: 알 수 없는 period 값은 silent fallback 대신 명시적 400으로 거부
      //   (#326 정책 — 입력 검증 실패가 silent wrong result 되지 않도록 통일)
      if (q.period !== undefined && !(validPeriods as string[]).includes(q.period)) {
        return reply.code(400).send({
          error: 'invalid_period',
          message: `period must be one of: ${validPeriods.join(', ')}`,
        });
      }
      const period: StatsPeriod = (q.period as StatsPeriod | undefined) ?? '24h';

      // custom 기간: from/to 필수 검증 — 누락·비정수·역전 시 400
      let range: { from: number; to: number } | undefined;
      if (period === 'custom') {
        const from = Number(q.from);
        const to = Number(q.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
          // 표준 envelope (#329)
          return reply.code(400).send({
            error: 'invalid_period',
            message: 'period=custom requires numeric from < to',
          });
        }
        range = { from, to };
      }

      // getStats()의 snake_case + 배열 형태를 프론트엔드 DomainStats 타입으로 변환
      const raw = statsRepo.getStats(host, period, range);
      const labels = raw.timeseries.map((r) =>
        period === '1h' || period === '24h'
          ? new Date(r.timestamp * 1000).toISOString().slice(11, 16) // "HH:MM"
          : new Date(r.timestamp * 1000).toISOString().slice(0, 10),  // "YYYY-MM-DD"
      );
      return {
        host,
        period,
        summary: {
          totalRequests: raw.summary.total_requests,
          requestsDelta: raw.summary.requests_delta,
          cacheHitRate: raw.summary.hit_rate,
          cacheHitRateDelta: raw.summary.hit_rate_delta,
          bandwidth: raw.summary.total_bandwidth,
          avgResponseTime: raw.summary.avg_response_time,
          responseTimeDelta: raw.summary.response_time_delta,
        },
        timeseries: {
          labels,
          hits: raw.timeseries.map((r) => r.cache_hits),
          misses: raw.timeseries.map((r) => r.cache_misses),
          bandwidth: raw.timeseries.map((r) => r.bandwidth),
          responseTime: raw.timeseries.map((r) => r.avg_response_time),
        },
      };
    },
  );

  // 로그 기간 필터용 시간 상수 (매직 넘버 방지)
  const LOG_HOUR_SECONDS  = 3600;
  const LOG_DAY_SECONDS   = 86400;
  const LOG_WEEK_SECONDS  = 604800;
  const LOG_MONTH_SECONDS = 2592000;

  /** 도메인 로그 조회 (period/from/to/q/status/cache/limit/offset 필터) */
  app.get<{
    Params: { host: string };
    Querystring: {
      limit?: string; offset?: string;
      status?: string; cache?: string;
      period?: string; from?: string; to?: string;
      q?: string;
    };
  }>('/api/domains/:host/logs', async (request, reply) => {
    const host = normalizeHost(decodeURIComponent(request.params.host));
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }

    // #418: limit/offset strict 검증 — 기존 silent clamp(#149) 는 잘못된 입력을 묵시적으로 보정해
    //   운영자가 페이지네이션 실패를 인지하지 못하게 만들었다. #408/#413/#415 정책(알 수 없는 쿼리
    //   값은 명시적 400 invalid_input)에 맞춰 동일 envelope 로 거부한다. SQLite 음수 OFFSET 회귀
    //   가드(#149)는 zod 검증이 SQL 단계 이전에 차단하므로 그대로 보존된다.
    const limitRaw = request.query.limit;
    let limit = 100; // logs 기본값 유지
    if (limitRaw !== undefined && limitRaw !== '') {
      const parsed = z.coerce.number().int().min(1).max(1000).safeParse(limitRaw);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_input',
          message: `limit must be an integer between 1 and 1000 (received: "${limitRaw}")`,
          issues: parsed.error.issues,
        });
      }
      limit = parsed.data;
    }
    const offsetRaw = request.query.offset;
    let offset = 0;
    if (offsetRaw !== undefined && offsetRaw !== '') {
      const parsed = z.coerce.number().int().min(0).safeParse(offsetRaw);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_input',
          message: `offset must be a non-negative integer (received: "${offsetRaw}")`,
          issues: parsed.error.issues,
        });
      }
      offset = parsed.data;
    }
    const { status, cache, period, q } = request.query;

    // #408: 알 수 없는 period 값은 silent fallback(필터 무시) 대신 명시적 400으로 거부
    //   (#326 정책 — stats 라우트와 동일하게 통일)
    const validLogPeriods = ['1h', '24h', '7d', '30d', 'custom'] as const;
    if (period !== undefined && !(validLogPeriods as readonly string[]).includes(period)) {
      return reply.code(400).send({
        error: 'invalid_period',
        message: `period must be one of: ${validLogPeriods.join(', ')}`,
      });
    }

    // #413: status/cache enum 쿼리도 동일한 화이트리스트 검증 적용
    //   기존엔 화이트리스트 밖 값을 silent하게 무시(=필터 미적용)하고 200을 반환했으나,
    //   #326/#408 정책에 따라 알 수 없는 값은 명시적 400 invalid_input envelope로 거부한다.
    const validLogStatuses = ['5xx', '4xx', 'error'] as const;
    if (status !== undefined && !(validLogStatuses as readonly string[]).includes(status)) {
      return reply.code(400).send({
        error: 'invalid_status',
        message: `status must be one of: ${validLogStatuses.join(', ')}`,
      });
    }
    const validLogCaches = ['hit', 'miss'] as const;
    if (cache !== undefined && !(validLogCaches as readonly string[]).includes(cache)) {
      return reply.code(400).send({
        error: 'invalid_cache',
        message: `cache must be one of: ${validLogCaches.join(', ')}`,
      });
    }

    // period → since/until 변환 (없으면 시간 필터 없음)
    let since: number | undefined;
    let until: number | undefined;
    if (period) {
      const now = Math.floor(Date.now() / 1000);
      if (period === '1h') {
        // 최근 1시간
        since = now - LOG_HOUR_SECONDS;
      } else if (period === '24h') {
        since = now - LOG_DAY_SECONDS;
      } else if (period === '7d') {
        since = now - LOG_WEEK_SECONDS;
      } else if (period === '30d') {
        since = now - LOG_MONTH_SECONDS;
      } else if (period === 'custom') {
        // custom: from/to 필수 — 누락·비정수·역전 시 400 반환
        const fromNum = Number(request.query.from);
        const toNum   = Number(request.query.to);
        if (!Number.isFinite(fromNum) || !Number.isFinite(toNum) || toNum <= fromNum) {
          // 표준 envelope (#329)
          return reply.code(400).send({
            error: 'invalid_period',
            message: 'period=custom requires numeric from < to',
          });
        }
        since = fromNum;
        until = toNum;
      }
      // 알 수 없는 period 값은 위 화이트리스트 검증에서 이미 400으로 거부됨 (#408)
    }

    // access_logs 테이블이 없을 수 있으므로 try/catch로 빈 배열 폴백
    try {
      const db = domainRepo.database;
      const conditions: string[] = ['host = ?'];
      const params: (string | number)[] = [host];

      // 시간 범위 필터 — period 지정 시에만 적용
      if (since !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(since);
      }
      if (until !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(until);
      }

      // status 필터: '5xx' → 500+, '4xx' → 400~499, 'error' → 4xx+5xx 통합
      if (status === '5xx') {
        conditions.push('status_code >= 500');
      } else if (status === '4xx') {
        conditions.push('status_code >= 400 AND status_code < 500');
      } else if (status === 'error') {
        // 'error': 4xx + 5xx 모두 포함 — 클라이언트의 "에러만" 토글에서 사용
        conditions.push('status_code >= 400');
      }

      // cache 필터: 'hit' / 'miss'
      if (cache === 'hit' || cache === 'miss') {
        conditions.push('cache_status = ?');
        params.push(cache.toUpperCase());
      }

      // q: path 부분 문자열 검색 (LIKE) — 특수문자 이스케이프로 리터럴 검색 보장
      if (q) {
        conditions.push(`path LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(q)}%`);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      params.push(limit, offset);

      const rows = db
        .prepare(
          `SELECT timestamp, status_code, cache_status, path, size FROM access_logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params);

      return rows;
    } catch {
      // access_logs 테이블이 존재하지 않으면 proxy in-memory 링버퍼에 위임 (Task 17 폴백)
      return fetchProxyLogs({
        host, since, until, status, cache, q, limit, offset,
      });
    }
  });

  /** 기간 내 상위 URL 집계 — 요청 수 내림차순으로 limit개 반환 */
  app.get<{
    Params: { host: string };
    Querystring: {
      period?: string; from?: string; to?: string; limit?: string;
    };
  }>(
    '/api/domains/:host/top-urls',
    async (request, reply) => {
      // 와일드카드 도메인(*.example.com)은 프론트엔드에서 encodeURIComponent로 인코딩되어 전달되므로
      // 다른 핸들러와 동일하게 디코딩해야 DB 조회가 정상 동작함
      const host = normalizeHost(decodeURIComponent(request.params.host));
      const q = request.query;
      // limit 방어: 1~20, 기본 5
      const limit = Math.min(Math.max(Number(q.limit ?? 5) || 5, 1), 20);

      // 기간별 since/until 결정 — 명명 상수 재사용
      const now = Math.floor(Date.now() / 1000);
      let since: number, until: number;
      if (q.period === '1h') {
        // 최근 1시간
        since = now - LOG_HOUR_SECONDS; until = now;
      } else if (q.period === '24h') {
        since = now - LOG_DAY_SECONDS; until = now;
      } else if (q.period === '7d') {
        since = now - LOG_WEEK_SECONDS; until = now;
      } else if (q.period === '30d') {
        since = now - LOG_MONTH_SECONDS; until = now;
      } else if (q.period === 'custom') {
        // custom: from/to 필수 — 누락·비정수·역전 시 400 반환
        const f = Number(q.from), t = Number(q.to);
        if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) {
          // 표준 envelope (#329)
          return reply.code(400).send({
            error: 'invalid_period',
            message: 'period=custom requires numeric from < to',
          });
        }
        since = f; until = t;
      } else {
        // 기본 24h
        since = now - LOG_DAY_SECONDS; until = now;
      }

      try {
        const rows = domainRepo.database.prepare(
          `SELECT path, COUNT(*) AS count FROM access_logs
           WHERE host = ? AND timestamp >= ? AND timestamp < ?
           GROUP BY path ORDER BY count DESC LIMIT ?`
        ).all(host, since, until, limit) as Array<{ path: string; count: number }>;
        return { urls: rows };
      } catch {
        // access_logs 테이블이 없으면 proxy 링버퍼에서 집계 (Task 17 폴백)
        // 링버퍼 용량(100)을 그대로 조회하여 경로별 카운트 후 상위 limit개 반환
        const logs = await fetchProxyLogs({
          host, since, until: until - 1, limit: 1000, offset: 0,
        });
        const counts = new Map<string, number>();
        for (const l of logs) {
          counts.set(l.path, (counts.get(l.path) ?? 0) + 1);
        }
        const urls = Array.from(counts.entries())
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);
        return { urls };
      }
    },
  );

  /** Phase 16-3: URL별 최적화 집계 — optimization_events를 URL 기준 GROUP BY 후
   *  savings/orig_size/events 정렬과 decision/q 필터를 적용해 페이지네이션 결과를 반환한다. */
  app.get<{
    Params: { host: string };
    Querystring: { period?: string; sort?: string; decision?: string; q?: string; limit?: string; offset?: string };
  }>('/api/domains/:host/optimization/url-breakdown', async (req, reply) => {
    // 와일드카드 호스트(`*.textbook.com`)는 URL 인코딩되어 `%2A.textbook.com`로 들어오므로 디코딩 필요
    const host = normalizeHost(decodeURIComponent(req.params.host));
    const periodMap: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 };
    // #415: period/sort/decision/limit/offset 모두 silent fallback 제거 — #408 정책(invalid_<param> 400) 확대.
    //   기존엔 알 수 없는 값이 들어와도 각각 24h/'savings'/0건/clampInt fallback 으로 silent 변환됐다.
    //   같은 도메인 라우트의 /stats·/logs 는 #408/#413 으로 이미 400 거부 — 본 라우트만 누락된 회귀 누수.
    const periodRaw = req.query.period;
    if (periodRaw !== undefined && periodRaw !== '' && periodMap[periodRaw] === undefined) {
      // 표준 envelope (#327/#410) — /stats 의 invalid_period 와 동일 형식
      return reply.code(400).send({
        error: 'invalid_period',
        message: `period must be one of: ${Object.keys(periodMap).join(', ')} (received: "${periodRaw}")`,
      });
    }
    const periodSec = periodMap[periodRaw ?? '24h'] ?? 86400;

    const sortRaw = req.query.sort;
    const SORT_ALLOWED = ['savings', 'orig_size', 'events'] as const;
    if (sortRaw !== undefined && sortRaw !== ''
        && !(SORT_ALLOWED as readonly string[]).includes(sortRaw)) {
      // 표준 envelope (#327/#410)
      return reply.code(400).send({
        error: 'invalid_sort',
        message: `sort must be one of: ${SORT_ALLOWED.join(', ')} (received: "${sortRaw}")`,
      });
    }
    const sort = (sortRaw && (SORT_ALLOWED as readonly string[]).includes(sortRaw))
      ? sortRaw as typeof SORT_ALLOWED[number]
      : 'savings';

    // decision 화이트리스트 — /api/optimization/events 와 동일 정책 (#318). 빈 문자열·미지정은 필터 비활성.
    const decisionRaw = req.query.decision;
    if (decisionRaw !== undefined && decisionRaw !== '' && !ALLOWED_DECISIONS.has(decisionRaw)) {
      // 표준 envelope (#327/#410)
      return reply.code(400).send({
        error: 'invalid_decision',
        message: `invalid decision: ${decisionRaw}`,
      });
    }

    // limit/offset zod 검증 — abc/-1/0/1.5 같은 비정상 값이 repo clampInt 로 silent 보정되던 경로를 차단.
    const limitRaw = req.query.limit;
    let limitNum: number | undefined;
    if (limitRaw !== undefined && limitRaw !== '') {
      const parsed = z.coerce.number().int().min(1).max(500).safeParse(limitRaw);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: `limit must be an integer in [1, 500] (received: "${limitRaw}")`,
          issues: parsed.error.issues,
        });
      }
      limitNum = parsed.data;
    }
    const offsetRaw = req.query.offset;
    let offsetNum: number | undefined;
    if (offsetRaw !== undefined && offsetRaw !== '') {
      const parsed = z.coerce.number().int().min(0).safeParse(offsetRaw);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: `offset must be a non-negative integer (received: "${offsetRaw}")`,
          issues: parsed.error.issues,
        });
      }
      offsetNum = parsed.data;
    }

    const repo = new OptimizationEventsRepository(domainRepo.database);
    return repo.urlBreakdown({
      host,
      period_sec: periodSec,
      sort,
      decision:   decisionRaw !== '' ? decisionRaw : undefined,
      search:     req.query.q,
      limit:      limitNum,
      offset:     offsetNum,
    });
  });

  /** 도메인 삭제 */
  app.delete<{ Params: { host: string } }>('/api/domains/:host', async (request, reply) => {
    // URL 인코딩된 호스트 디코딩 (*.textbook.com → %2A.textbook.com으로 전달됨)
    const host = normalizeHost(decodeURIComponent(request.params.host));
    // (#192) host 단위 락으로 toggle/PUT과 직렬화 — 삭제 중 끼어든 토글이 사라진 도메인을 가리키는 race 방지
    return withHostLock(host, async () => {
    // (#311) 삭제 + Proxy 동기화 + 실패 시 복원을 단일 SQLite 트랜잭션으로 감싼다.
    // 기존 구현은 `delete()` 후 `upsert()` 로 롤백을 시도했으나 두 가지 데이터 손실이 있었다:
    //   (a) upsert 의 INSERT 분기가 `created_at` 를 명시 지정하지 않아 DEFAULT(현재 시각)로 재설정
    //   (b) FK ON DELETE CASCADE 로 `domain_stats` 행이 영구 삭제되어 통계 차트가 초기화
    // BEGIN IMMEDIATE → DELETE → await syncToProxy → 결과에 따라 COMMIT/ROLLBACK 으로 변경하면
    // ROLLBACK 시 도메인 행은 created_at 포함 원형 그대로, domain_stats CASCADE 도 자동 복원된다.
    // 빠른 404 경로 — 트랜잭션 진입 전에 존재 여부 확인 (없으면 BEGIN IMMEDIATE 비용 절약)
    if (!domainRepo.findByHost(host)) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    const txResult = await domainRepo.runInTransactionAsync<{ ok: boolean; existed: boolean }>(async () => {
      const deleted = domainRepo.delete(host);
      if (deleted === 0) {
        // 락 획득 직전 다른 요청이 먼저 삭제했을 수 있다 — ROLLBACK 으로 빠져나간다
        return { commit: false, value: { ok: false, existed: false } };
      }
      // syncToProxy 는 같은 better-sqlite3 커넥션으로 SELECT 하므로 트랜잭션 내부의 미커밋
      // 상태(=해당 host 가 빠진 목록)를 그대로 읽어 Proxy 에 보낸다. 실패 시 ROLLBACK 으로
      // 도메인 + domain_stats 가 트랜잭션 시작 직전 상태로 자동 복원된다.
      const synced = await syncToProxy(domainRepo);
      return { commit: synced, value: { ok: synced, existed: true } };
    });
    if (!txResult.existed) {
      return reply.status(404).send({ error: 'domain_not_found', message: '도메인을 찾을 수 없습니다.' });
    }
    if (!txResult.ok) {
      // 표준 envelope (#329)
      return reply.status(502).send({ error: 'proxy_sync_failed', message: 'Proxy 동기화 실패' });
    }
    // gRPC fan-out: tls-service + dns-service 도메인 동기화
    await fanOutGrpc(app, domainRepo);
    // 도메인 삭제 후 해당 호스트의 optimization_events orphan을 정리한다 (#185).
    // optimization_events 테이블에는 FK 제약이 없어 CASCADE가 동작하지 않으므로
    // 라우트에서 명시적으로 cleanup. proxy 동기화 성공 이후(point of no return)에
    // 호출해 도메인 복원 경로와의 일관성을 유지한다.
    const optEventsRepo = new OptimizationEventsRepository(domainRepo.database);
    optEventsRepo.deleteByHost(host);
    return reply.status(204).send();
    });
  });
}
