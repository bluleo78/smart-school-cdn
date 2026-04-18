/// 캐시 관리 API 라우트
/// storage-service gRPC(50051)를 통해 캐시 통계/인기 콘텐츠/퍼지를 제공한다.
import type { FastifyInstance } from 'fastify';

export async function cacheRoutes(app: FastifyInstance) {
  /** 캐시 통계 — domain_stats에서 L1/L2/bypass 집계 + storage-service에서 disk 정보 */
  app.get('/api/cache/stats', async () => {
    // 최근 24시간 데이터만 집계
    const sinceSec = Math.floor(Date.now() / 1000) - 24 * 3600;

    const total = app.db.prepare(`
      SELECT
        COALESCE(SUM(requests), 0)        AS requests,
        COALESCE(SUM(l1_hits), 0)         AS l1_hits,
        COALESCE(SUM(l2_hits), 0)         AS l2_hits,
        COALESCE(SUM(cache_misses), 0)    AS miss,
        COALESCE(SUM(bypass_method), 0)   AS bm,
        COALESCE(SUM(bypass_nocache), 0)  AS bn,
        COALESCE(SUM(bypass_size), 0)     AS bs,
        COALESCE(SUM(bypass_other), 0)    AS bo
      FROM domain_stats WHERE timestamp >= ?
    `).get(sinceSec) as {
      requests: number; l1_hits: number; l2_hits: number; miss: number;
      bm: number; bn: number; bs: number; bo: number;
    };

    // 도메인별 집계 — 요청수 내림차순 상위 20개
    const byDomain = app.db.prepare(`
      SELECT
        host,
        SUM(requests)                                             AS requests,
        SUM(l1_hits)                                              AS l1_hits,
        SUM(l2_hits)                                              AS l2_hits,
        SUM(bypass_method + bypass_nocache + bypass_size + bypass_other) AS bypass_total
      FROM domain_stats WHERE timestamp >= ?
      GROUP BY host
      ORDER BY requests DESC
      LIMIT 20
    `).all(sinceSec) as Array<{
      host: string; requests: number; l1_hits: number; l2_hits: number; bypass_total: number;
    }>;

    // storage-service offline이면 disk는 0으로 폴백
    let disk = { used_bytes: 0, max_bytes: 0, entry_count: 0 };
    try {
      const s = await app.storageClient.stats();
      disk = {
        used_bytes:  Number(s.used_bytes   ?? 0),
        max_bytes:   Number(s.total_bytes  ?? 0),
        entry_count: 0,
      };
    } catch {
      // storage offline → 0 폴백
    }

    const bypassTotal = total.bm + total.bn + total.bs + total.bo;
    const req = total.requests;
    const rate = (n: number) => (req > 0 ? n / req : 0);

    return {
      requests: req,
      l1_hits: total.l1_hits,
      l2_hits: total.l2_hits,
      miss: total.miss,
      bypass: {
        method:  total.bm,
        nocache: total.bn,
        size:    total.bs,
        other:   total.bo,
        total:   bypassTotal,
      },
      l1_hit_rate:   rate(total.l1_hits),
      edge_hit_rate: rate(total.l1_hits + total.l2_hits),
      bypass_rate:   rate(bypassTotal),
      disk,
      by_domain: byDomain.map(d => ({
        host:          d.host,
        requests:      d.requests,
        l1_hits:       d.l1_hits,
        l2_hits:       d.l2_hits,
        bypass_total:  d.bypass_total,
        l1_hit_rate:   d.requests > 0 ? d.l1_hits / d.requests : 0,
        edge_hit_rate: d.requests > 0 ? (d.l1_hits + d.l2_hits) / d.requests : 0,
      })),
    };
  });

  /** 시계열 버킷 — 스택 차트용 L1/L2/miss/bypass 집계, range=1h(분 단위)|24h(시간 단위) */
  const RANGE_TABLE: Record<string, { windowSec: number; bucketSec: number }> = {
    '1h':  { windowSec: 3600,  bucketSec: 60 },
    '24h': { windowSec: 86400, bucketSec: 3600 },
  };

  app.get<{ Querystring: { range?: string; host?: string } }>('/api/cache/series', async (req, reply) => {
    const range = req.query.range ?? '1h';
    const cfg = RANGE_TABLE[range];
    if (!cfg) {
      return reply.status(400).send({ error: `invalid range: ${range}` });
    }
    const sinceSec = Math.floor(Date.now() / 1000) - cfg.windowSec;
    const host = req.query.host;

    // host 필터가 있을 때만 WHERE 절에 AND host = ? 추가
    const hostWhere = host ? 'AND host = ?' : '';
    const params: unknown[] = host
      ? [cfg.bucketSec, cfg.bucketSec, sinceSec, host]
      : [cfg.bucketSec, cfg.bucketSec, sinceSec];

    const rows = app.db.prepare(`
      SELECT (timestamp / ?) * ?               AS bucket_ts_sec,
             COALESCE(SUM(l1_hits), 0)         AS l1_hits,
             COALESCE(SUM(l2_hits), 0)         AS l2_hits,
             COALESCE(SUM(cache_misses), 0)    AS miss,
             COALESCE(SUM(bypass_method + bypass_nocache + bypass_size + bypass_other), 0) AS bypass
      FROM domain_stats
      WHERE timestamp >= ? ${hostWhere}
      GROUP BY bucket_ts_sec
      ORDER BY bucket_ts_sec ASC
    `).all(...params) as Array<{
      bucket_ts_sec: number; l1_hits: number; l2_hits: number; miss: number; bypass: number;
    }>;

    return {
      buckets: rows.map(r => ({
        ts:      Number(r.bucket_ts_sec) * 1000,  // epoch ms 변환
        l1_hits: r.l1_hits,
        l2_hits: r.l2_hits,
        miss:    r.miss,
        bypass:  r.bypass,
      })),
    };
  });

  /** 인기 콘텐츠 목록 — hit_count 내림차순 상위 20개, domain 쿼리로 특정 도메인만 필터링 가능 */
  app.get<{ Querystring: { limit?: string; domain?: string } }>('/api/cache/popular', async (request) => {
    try {
      const limit = Number(request.query.limit ?? 20);
      const { domain } = request.query;
      const res = await app.storageClient.popular(limit);
      const entries = res.entries ?? [];
      if (domain) {
        return entries.filter((e: { url?: string }) => {
          try {
            return new URL(e.url ?? '').hostname === domain;
          } catch {
            return false;
          }
        });
      }
      return entries;
    } catch {
      return [];
    }
  });

  /** 캐시 퍼지 — URL / 도메인 / 전체 */
  app.delete<{
    Body: { type: 'url' | 'domain' | 'all'; target?: string };
  }>('/api/cache/purge', async (request, reply) => {
    const { type, target } = request.body;
    if (!type) {
      return reply.status(400).send({ error: 'type은 필수입니다.' });
    }
    if ((type === 'url' || type === 'domain') && !target) {
      return reply.status(400).send({ error: `type이 "${type}"이면 target은 필수입니다.` });
    }
    try {
      let res;
      if (type === 'url') {
        res = await app.storageClient.purgeUrl(target!);
      } else if (type === 'domain') {
        res = await app.storageClient.purgeDomain(target!);
      } else {
        res = await app.storageClient.purgeAll();
      }
      return res;
    } catch {
      return reply.status(502).send({ error: 'storage-service에 연결할 수 없습니다.' });
    }
  });
}
