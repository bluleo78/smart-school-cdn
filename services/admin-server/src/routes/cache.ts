/// 캐시 관리 API 라우트
/// storage-service gRPC(50051)를 통해 캐시 통계/인기 콘텐츠/퍼지를 제공한다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// 캐시 퍼지 요청 본문 스키마 — type 화이트리스트 검증.
// discriminatedUnion으로 'all' 외 임의 truthy 값이 purgeAll() 분기로 폴백되는 것을 차단한다 (#168).
// url/domain은 target 필수, all은 target 무관(optional).
const purgeBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'),    target: z.string().min(1) }),
  z.object({ type: z.literal('domain'), target: z.string().min(1) }),
  z.object({ type: z.literal('all') }),
]);

/**
 * 도메인/호스트 입력 정규화 (#297)
 * DNS 호스트는 case-insensitive(RFC 1035 §2.3.3)이고 사용자 입력에 앞뒤 공백이 섞일 수 있어
 * trim + lowercase로 정규형을 만든다. 도메인 등록/조회/프록시 테스트(#190·#201·#296)와 동일 패턴.
 */
function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

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
      // entry_count는 storage proto에 단일 필드가 없으므로 domain_stats[].file_count 합산으로 산출 (#195).
      // 합산 누락 시 대시보드 '캐시 항목' 카드가 항상 0으로 표시되어 운영 판단을 오도하던 결함을 수정.
      const totalEntries = (s.domain_stats ?? []).reduce(
        (sum, d) => sum + Number(d.file_count ?? 0),
        0,
      );
      disk = {
        used_bytes:  Number(s.used_bytes   ?? 0),
        max_bytes:   Number(s.total_bytes  ?? 0),
        entry_count: totalEntries,
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
  app.delete('/api/cache/purge', async (request, reply) => {
    // zod 화이트리스트 검증 — 'url' | 'domain' | 'all' 외 값은 모두 400 거부.
    // 검증 전에는 임의 type 값이 마지막 else로 흘러 purgeAll()을 호출하던 결함이 있었다 (#168).
    const parsed = purgeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      // target 누락은 기존 메시지 호환을 위해 별도로 가공
      const issues = parsed.error.issues;
      const targetMissing = issues.find(
        (i) => i.path.length === 1 && i.path[0] === 'target',
      );
      if (targetMissing) {
        // type은 url/domain 중 하나로 좁혀진 뒤 target만 누락된 경우
        const typeFromBody = (request.body as { type?: unknown } | null)?.type;
        return reply.status(400).send({
          error: `type이 "${String(typeFromBody)}"이면 target은 필수입니다.`,
        });
      }
      return reply.status(400).send({
        error: 'type은 "url" | "domain" | "all" 중 하나여야 합니다.',
        issues,
      });
    }
    const body = parsed.data;

    // URL 퍼지 시 대상 URL의 hostname이 등록된 도메인에 속하는지 검증한다.
    // 등록되지 않은 외부 도메인에 대한 크로스 도메인 퍼지를 방지한다 (#36).
    // 와일드카드 도메인(`*.base`)에 대해서는 base 자체 또는 base의 한 단계 이상 깊은 서브도메인을
    // 매칭으로 허용한다 — URL에 리터럴 `*`이 들어갈 수 없기 때문 (#234).
    if (body.type === 'url') {
      let hostname: string;
      try {
        // URL 표준상 hostname은 이미 ASCII 소문자로 정규화되지만, 다른 라우트(#190·#201·#296)와
        // 동일한 헬퍼를 통과시켜 비교 키 일관성을 명시한다.
        hostname = normalizeHost(new URL(body.target).hostname);
      } catch {
        return reply.status(400).send({ error: '유효하지 않은 URL 형식입니다.' });
      }
      // 1) 정확히 일치하는 일반 도메인 확인
      const exact = app.db
        .prepare('SELECT 1 FROM domains WHERE host = ? LIMIT 1')
        .get(hostname);
      let registered = !!exact;
      if (!registered) {
        // 2) 와일드카드 매칭 — hostname의 suffix(부모 도메인)에 대응하는 *.suffix가 등록되어 있는지 확인
        const candidates: string[] = [`*.${hostname}`];
        const parts = hostname.split('.');
        for (let i = 1; i < parts.length; i++) {
          candidates.push(`*.${parts.slice(i).join('.')}`);
        }
        const placeholders = candidates.map(() => '?').join(',');
        const wildcardHit = app.db
          .prepare(`SELECT 1 FROM domains WHERE host IN (${placeholders}) LIMIT 1`)
          .get(...candidates);
        registered = !!wildcardHit;
      }
      if (!registered) {
        return reply.status(400).send({ error: `${hostname}은(는) 등록된 도메인이 아닙니다.` });
      }
    }

    // 도메인 퍼지 시에도 target host가 등록된 도메인인지 동일하게 검증한다 (#168 부수 결함).
    // DNS 호스트는 case-insensitive(RFC 1035 §2.3.3)이고 사용자 입력에 공백이 섞일 수 있어
    // 도메인 등록/조회/프록시 테스트 라우트(#190·#201·#296)와 동일한 trim+lowercase 정규화를
    // 적용한다 (#297). 에러 메시지에도 정규화된 값을 노출해 사용자 혼란을 방지한다.
    if (body.type === 'domain') {
      const target = normalizeHost(body.target);
      const registered = app.db
        .prepare('SELECT 1 FROM domains WHERE host = ? LIMIT 1')
        .get(target);
      if (!registered) {
        return reply
          .status(400)
          .send({ error: `${target}은(는) 등록된 도메인이 아닙니다.` });
      }
      // 후속 storageClient.purgeDomain 호출도 정규화된 값을 사용해 매칭 일관성을 보장한다.
      body.target = target;
    }

    try {
      let res;
      if (body.type === 'url') {
        res = await app.storageClient.purgeUrl(body.target);
      } else if (body.type === 'domain') {
        res = await app.storageClient.purgeDomain(body.target);
      } else {
        res = await app.storageClient.purgeAll();
      }
      // gRPC 응답 필드명(purged_files)을 클라이언트 계약(purged_count)으로 정규화한다 (#182).
      // storage-service의 .proto는 purged_files를 사용하지만 admin-web은 purged_count를 기대한다.
      // 또한 .proto의 uint64 필드는 @grpc/grpc-js가 정밀도 보존을 위해 string으로 역직렬화하므로
      // admin-web의 number 계약에 맞춰 Number 변환한다 (#208 — string "0" 이 ===0 비교를 빠져나가
      // "0건 삭제" 성공 토스트를 띄우는 회귀를 차단).
      return { purged_count: Number(res.purged_files), freed_bytes: Number(res.freed_bytes) };
    } catch {
      return reply.status(502).send({ error: 'storage-service에 연결할 수 없습니다.' });
    }
  });
}
