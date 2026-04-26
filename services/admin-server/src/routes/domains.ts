/// 도메인 관리 API 라우트
/// Admin Server가 도메인의 소유자 — 변경 시 Proxy admin API(8081) + tls/dns gRPC 서비스에 전체 목록 push
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import type { DomainRepository } from '../db/domain-repo.js';
import { DomainStatsRepository } from '../db/domain-stats-repo.js';
import type { StatsPeriod } from '../db/domain-stats-repo.js';
import { OptimizationEventsRepository } from '../db/optimization-events-repo.js';

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

  /** 전체 도메인 목록 조회 — q/enabled/sort 쿼리 파라미터 지원 */
  app.get<{ Querystring: { q?: string; enabled?: string; sort?: string } }>(
    '/api/domains',
    async (request) => {
      const { q, enabled, sort } = request.query;
      return domainRepo.findAll({
        q,
        enabled: enabled !== undefined ? enabled === 'true' || enabled === '1' : undefined,
        sort,
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

    // hourly: 전체 도메인의 시간별 요청 합산 (최대 24개 버킷)
    const maxBuckets = 24;
    const hourlyRequests = Array<number>(maxBuckets).fill(0);
    for (const r of perHost) {
      const buckets = r.hourly.slice(-maxBuckets);
      const offset = maxBuckets - buckets.length;
      for (let i = 0; i < buckets.length; i++) {
        hourlyRequests[offset + i] += buckets[i];
      }
    }

    // perHost에서 delta 집계 — 전체 도메인의 평균 변화율
    const totalTodayRequestsDelta = perHost.length > 0
      ? perHost.reduce((sum, r) => sum + r.today_requests_delta, 0) / perHost.length
      : 0;
    const totalHitRateDelta = perHost.length > 0
      ? perHost.reduce((sum, r) => sum + r.hit_rate_delta, 0) / perHost.length
      : 0;

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
      hourlyCacheHitRate: Array<number>(maxBuckets).fill(0),
      hourlyBandwidth: Array<number>(maxBuckets).fill(0),
      alerts: [],
    };
  });

  /** 도메인 일괄 추가 — 성공한 각 도메인에 기본 최적화 프로파일 자동 생성 */
  app.post<{ Body: { domains?: Array<{ host: string; origin: string }> } }>(
    '/api/domains/bulk',
    async (request, reply) => {
      const { domains } = request.body ?? {};
      if (!Array.isArray(domains) || domains.length === 0) {
        return reply.status(400).send({ error: 'domains 배열은 필수 항목입니다.' });
      }
      const result = domainRepo.bulkInsert(domains);
      const synced = await syncToProxy(domainRepo);
      if (!synced) {
        return reply.status(502).send({ error: 'Proxy 동기화 실패', result });
      }
      await fanOutGrpc(app, domainRepo);
      // 성공한 각 도메인에 기본 최적화 프로파일 생성 — 실패해도 전체 응답은 성공 처리
      const failedHosts = new Set(result.failed.map((f) => f.host));
      const successHosts = domains.map((d) => d.host).filter((h) => !failedHosts.has(h));
      await Promise.allSettled(
        successHosts.map(async (host) => {
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
      const { hosts } = request.body ?? {};
      if (!Array.isArray(hosts) || hosts.length === 0) {
        return reply.status(400).send({ error: 'hosts 배열은 필수 항목입니다.' });
      }
      const deleted = domainRepo.bulkDelete(hosts);
      const synced = await syncToProxy(domainRepo);
      if (!synced) {
        return reply.status(502).send({ error: 'Proxy 동기화 실패' });
      }
      await fanOutGrpc(app, domainRepo);
      return reply.status(200).send({ deleted });
    },
  );

  /** 도메인 추가 (이미 있으면 origin 갱신) — 추가 성공 후 기본 최적화 프로파일 자동 생성 */
  app.post<{ Body: { host?: string; origin?: string } }>(
    '/api/domains',
    async (request, reply) => {
      const { host, origin } = request.body ?? {};
      if (!host || !origin) {
        return reply.status(400).send({ error: 'host와 origin은 필수 항목입니다.' });
      }
      domainRepo.upsert(host, origin);
      const synced = await syncToProxy(domainRepo);
      if (!synced) {
        return reply.status(502).send({
          error: 'Proxy 동기화 실패',
          domain: domainRepo.findByHost(host),
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
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    return domain;
  });

  /** 도메인 편집 (origin, enabled, description) */
  app.put<{
    Params: { host: string };
    Body: { origin?: string; enabled?: number; description?: string };
  }>('/api/domains/:host', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    const { origin, enabled, description } = request.body ?? {};
    const updated = domainRepo.update(host, { origin, enabled, description });
    if (!updated) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    const synced = await syncToProxy(domainRepo);
    if (!synced) {
      return reply.status(502).send({ error: 'Proxy 동기화 실패' });
    }
    await fanOutGrpc(app, domainRepo);
    return updated;
  });

  /** 도메인 활성/비활성 토글 — 실패 시 롤백 + 502 */
  app.post<{ Params: { host: string } }>('/api/domains/:host/toggle', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    const toggled = domainRepo.toggleEnabled(host);
    if (!toggled) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    const synced = await syncToProxy(domainRepo);
    if (!synced) {
      // 롤백 — 다시 토글하여 원래 상태 복원
      domainRepo.toggleEnabled(host);
      return reply.status(502).send({ error: 'Proxy 동기화 실패' });
    }
    await fanOutGrpc(app, domainRepo);
    return toggled;
  });

  /** 도메인 강제 동기화 — Proxy + TLS + DNS 서비스에 전체 목록 재전송 */
  app.post<{ Params: { host: string } }>('/api/domains/:host/sync', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
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
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    try {
      // Proxy는 /domains/{host}/purge 엔드포인트를 노출함 (올바른 URL 사용)
      await axios.post(`${PROXY_ADMIN_URL}/domains/${encodeURIComponent(host)}/purge`, {}, { timeout: 5000 });
      return reply.status(200).send({ ok: true });
    } catch (err) {
      return reply.status(502).send({
        error: 'Proxy 캐시 퍼지 실패',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** 단일 도메인 요약 통계 — L1/Edge/Bypass 비율 포함 (Overview 카드용) */
  app.get<{ Params: { host: string } }>(
    '/api/domains/:host/summary',
    async (request, reply) => {
      const host = decodeURIComponent(request.params.host);
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
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
      const host = decodeURIComponent(request.params.host);
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
      }
      const q = request.query;
      // 1h, custom 추가 — 기존 24h/7d/30d 동작 유지
      const validPeriods: StatsPeriod[] = ['1h', '24h', '7d', '30d', 'custom'];
      const period: StatsPeriod =
        q.period && (validPeriods as string[]).includes(q.period)
          ? (q.period as StatsPeriod)
          : '24h';

      // custom 기간: from/to 필수 검증 — 누락·비정수·역전 시 400
      let range: { from: number; to: number } | undefined;
      if (period === 'custom') {
        const from = Number(q.from);
        const to = Number(q.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
          return reply.code(400).send({ error: 'period=custom requires numeric from < to' });
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
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }

    const limit = Math.min(Number(request.query.limit) || 100, 1000);
    const offset = Number(request.query.offset) || 0;
    const { status, cache, period, q } = request.query;

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
          return reply.code(400).send({ error: 'period=custom requires numeric from < to' });
        }
        since = fromNum;
        until = toNum;
      }
      // 알 수 없는 period 값은 무시하여 기존 동작 유지
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

      // q: path 부분 문자열 검색 (LIKE)
      if (q) {
        conditions.push('path LIKE ?');
        params.push(`%${q}%`);
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
      const { host } = request.params;
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
          return reply.code(400).send({ error: 'period=custom requires numeric from < to' });
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
  }>('/api/domains/:host/optimization/url-breakdown', async (req) => {
    // 와일드카드 호스트(`*.textbook.com`)는 URL 인코딩되어 `%2A.textbook.com`로 들어오므로 디코딩 필요
    const host = decodeURIComponent(req.params.host);
    const periodMap: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 604800, '30d': 2592000 };
    const periodSec = periodMap[req.query.period ?? '24h'] ?? 86400;
    const sort = (['savings', 'orig_size', 'events'] as const).find((s) => s === req.query.sort) ?? 'savings';
    // limit/offset은 Number() 결과가 NaN/Infinity면 undefined로 처리해 `LIMIT NaN` SQL 에러를 방지
    const limitParsed  = req.query.limit  !== undefined ? Number(req.query.limit)  : NaN;
    const offsetParsed = req.query.offset !== undefined ? Number(req.query.offset) : NaN;
    const repo = new OptimizationEventsRepository(domainRepo.database);
    return repo.urlBreakdown({
      host,
      period_sec: periodSec,
      sort,
      decision:   req.query.decision,
      search:     req.query.q,
      limit:      Number.isFinite(limitParsed)  ? limitParsed  : undefined,
      offset:     Number.isFinite(offsetParsed) ? offsetParsed : undefined,
    });
  });

  /** 도메인 삭제 */
  app.delete<{ Params: { host: string } }>('/api/domains/:host', async (request, reply) => {
    // URL 인코딩된 호스트 디코딩 (*.textbook.com → %2A.textbook.com으로 전달됨)
    const host = decodeURIComponent(request.params.host);
    const deleted = domainRepo.delete(host);
    if (deleted === 0) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    const synced = await syncToProxy(domainRepo);
    if (!synced) {
      return reply.status(502).send({ error: 'Proxy 동기화 실패' });
    }
    // gRPC fan-out: tls-service + dns-service 도메인 동기화
    await fanOutGrpc(app, domainRepo);
    return reply.status(204).send();
  });
}
