// DNS 관리 — 읽기 전용 API. dns-service 실시간 3종 + SQLite 시계열 1종.
import type { FastifyInstance } from 'fastify';
import type { DnsClient } from '../grpc/dns_client.js';
import type { DnsMetricsRepository } from '../db/dns-metrics-repo.js';

declare module 'fastify' {
  interface FastifyInstance {
    dnsClient: DnsClient;
    dnsMetricsRepo: DnsMetricsRepository;
  }
}

const RANGE_MS: Record<string, number> = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export async function dnsRoutes(app: FastifyInstance) {
  /** 서비스 상태 + 누적 카운터 + Top 10 (실시간, dns-service 프록시)
   *  shared.ts의 longs: String 매핑으로 uint64 필드가 string으로 도착하므로 Number()로 변환해 경계에서 숫자화한다. */
  app.get('/api/dns/status', async (_req, reply) => {
    try {
      const s = await app.dnsClient.getStats();
      return reply.send({
        online: true,
        uptime_secs: Number(s.uptime_secs),
        total:       Number(s.total_queries),
        matched:     Number(s.matched),
        nxdomain:    Number(s.nxdomain),
        forwarded:   Number(s.forwarded),
        top_domains: s.top_domains,
      });
    } catch {
      return reply.send({
        online: false,
        uptime_secs: 0,
        total: 0, matched: 0, nxdomain: 0, forwarded: 0,
        top_domains: [],
      });
    }
  });

  /** 자동 매핑된 A 레코드 목록 */
  app.get('/api/dns/records', async (_req, reply) => {
    try {
      const r = await app.dnsClient.getRecords();
      return reply.send({ records: r.records });
    } catch {
      return reply.send({ records: [] });
    }
  });

  /** 최근 쿼리 로그 — 인메모리 링버퍼 스냅샷. ts_unix_ms(int64)도 Number로 변환. */
  app.get<{ Querystring: { limit?: string } }>('/api/dns/queries', async (req, reply) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 512);
    try {
      const r = await app.dnsClient.getRecentQueries(limit);
      return reply.send({
        entries: r.entries.map(e => ({
          ts_unix_ms: Number(e.ts_unix_ms),
          client_ip:  e.client_ip,
          qname:      e.qname,
          qtype:      e.qtype,
          result:     e.result,
          latency_us: e.latency_us,
        })),
      });
    } catch {
      return reply.send({ entries: [] });
    }
  });

  /** 시계열 메트릭 — SQLite에서 범위 조회 */
  app.get<{ Querystring: { range?: string } }>('/api/dns/metrics', async (req, reply) => {
    const range = req.query.range ?? '1h';
    const windowMs = RANGE_MS[range];
    if (windowMs === undefined) {
      return reply.status(400).send({ error: `invalid range: ${range}` });
    }
    const now = Date.now();
    const buckets = app.dnsMetricsRepo.range(now - windowMs, now);
    return reply.send({
      buckets: buckets.map(b => ({
        ts: b.bucket_ts,
        total: b.total, matched: b.matched, nxdomain: b.nxdomain, forwarded: b.forwarded,
      })),
    });
  });
}
