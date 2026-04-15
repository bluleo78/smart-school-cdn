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
  // DB 인스턴스는 DomainRepository 내부의 private db에서 꺼낼 수 없으므로
  // domainRepo의 db에 직접 접근하기 위해 타입 캐스트를 사용한다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statsRepo = new DomainStatsRepository((domainRepo as any).db);

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

  /** 전체 도메인 요약 통계 (카드용) */
  app.get('/api/domains/summary', async () => {
    return statsRepo.getSummaryAll();
  });

  /** 도메인 일괄 추가 */
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

  /** 도메인 추가 (이미 있으면 origin 갱신) */
  app.post<{ Body: { host?: string; origin?: string } }>(
    '/api/domains',
    async (request, reply) => {
      const { host, origin } = request.body ?? {};
      if (!host || !origin) {
        return reply.status(400).send({ error: 'host와 origin은 필수 항목입니다.' });
      }
      domainRepo.upsert(host, origin);
      await syncToProxy(domainRepo);
      await fanOutGrpc(app, domainRepo);
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

  /** 도메인 캐시 퍼지 — Proxy에 POST 요청 */
  app.post<{ Params: { host: string } }>('/api/domains/:host/purge', async (request, reply) => {
    const host = decodeURIComponent(request.params.host);
    const domain = domainRepo.findByHost(host);
    if (!domain) {
      return reply.status(404).send({ error: '도메인을 찾을 수 없습니다.' });
    }
    try {
      await axios.post(`${PROXY_ADMIN_URL}/cache/purge`, { host }, { timeout: 5000 });
      return reply.status(200).send({ ok: true });
    } catch (err) {
      return reply.status(502).send({
        error: 'Proxy 캐시 퍼지 실패',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

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
      return statsRepo.getStats(host, period);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (domainRepo as any).db;
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
          `SELECT * FROM access_logs ${where} ORDER BY created_at DESC LIMIT ?`,
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
