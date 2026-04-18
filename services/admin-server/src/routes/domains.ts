/// 도메인 관리 API 라우트
/// Admin Server가 도메인의 소유자 — 변경 시 Proxy admin API(8081) + tls/dns gRPC 서비스에 전체 목록 push
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import type { DomainRepository } from '../db/domain-repo.js';
import { DomainStatsRepository } from '../db/domain-stats-repo.js';
import type { StatsPeriod } from '../db/domain-stats-repo.js';

const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';

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

  /** 도메인 통계 조회 (period: 24h | 7d | 30d) */
  app.get<{ Params: { host: string }; Querystring: { period?: string } }>(
    '/api/domains/:host/stats',
    async (request, reply) => {
      const host = decodeURIComponent(request.params.host);
      const domain = domainRepo.findByHost(host);
      if (!domain) {
        return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
      }
      const periodParam = request.query.period;
      const validPeriods: StatsPeriod[] = ['24h', '7d', '30d'];
      const period: StatsPeriod =
        periodParam && (validPeriods as string[]).includes(periodParam)
          ? (periodParam as StatsPeriod)
          : '24h';
      // getStats()의 snake_case + 배열 형태를 프론트엔드 DomainStats 타입으로 변환
      const raw = statsRepo.getStats(host, period);
      const labels = raw.timeseries.map((r) =>
        period === '24h'
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

  /** 도메인 로그 조회 (limit, status, cache 필터) */
  app.get<{
    Params: { host: string };
    Querystring: { limit?: string; status?: string; cache?: string };
  }>('/api/domains/:host/logs', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }

    const limit = Math.min(Number(request.query.limit) || 100, 1000);
    const { status, cache } = request.query;

    // access_logs 테이블이 없을 수 있으므로 try/catch로 빈 배열 폴백
    try {
      const db = domainRepo.database;
      const conditions: string[] = ['host = ?'];
      const params: (string | number)[] = [host];

      // status 필터: '5xx' → 500+, '4xx' → 400~499
      if (status === '5xx') {
        conditions.push('status_code >= 500');
      } else if (status === '4xx') {
        conditions.push('status_code >= 400 AND status_code < 500');
      }

      // cache 필터: 'hit' / 'miss'
      if (cache === 'hit' || cache === 'miss') {
        conditions.push('cache_status = ?');
        params.push(cache);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      params.push(limit);

      const rows = db
        .prepare(
          `SELECT timestamp, status_code, cache_status, path, size FROM access_logs ${where} ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(...params);

      return rows;
    } catch {
      // access_logs 테이블이 존재하지 않으면 빈 배열 반환
      return [];
    }
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
