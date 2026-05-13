/// URL 진단 라우트 (#387)
/// host(path param) + path/query/range(query string) 를 받아 proxy admin `/diagnose`,
/// storage `GetMetadata`, admin-server 의 `optimization_events` 집계를 fan-in 한다.
/// 부분 실패 시 해당 필드를 null 로 두고 200 을 유지한다 (진단은 진단이 멈추지 않도록).

import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { createHash } from 'node:crypto';

/** querystring 검증 스키마 */
const querySchema = z.object({
  path:  z.string().startsWith('/', { message: 'path must start with /' }),
  query: z.string().optional().default(''),
  range: z.enum(['1h', '24h', '7d']).optional().default('1h'),
});

/** range 레이블 → 초 변환 */
const PERIOD_SEC: Record<'1h' | '24h' | '7d', number> = { '1h': 3600, '24h': 86400, '7d': 604800 };

/** DNS 호스트 정규화 — RFC 1035 §2.3.3 + 도메인 입력 정규화 패턴 */
function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * proxy 가 사용하는 캐시 키 계산 — SHA-256(GET:host{path}?{query}) hex.
 * proxy 내부 compute_cache_key 와 반드시 동일해야 진단 결과가 일치한다.
 */
function cacheKey(host: string, path: string, query: string): string {
  return createHash('sha256').update(`GET:${host}${path}?${query}`).digest('hex');
}

/**
 * origin 상태 판정.
 * - sample 이 0 이면 데이터 없음 → null
 * - 실패율(5xx + timeout) 50% 이상 → 'down'
 * - 실패율 10% 이상 → 'degraded'
 * - 그 외 → 'ok'
 */
function originStatus(error5xx: number, timeout: number, sample: number): 'ok' | 'degraded' | 'down' | null {
  if (sample === 0) return null;
  const rate = (error5xx + timeout) / sample;
  if (rate >= 0.5) return 'down';
  if (rate >= 0.1) return 'degraded';
  return 'ok';
}

/** URL 진단 라우트 등록 */
export async function diagnoseRoutes(app: FastifyInstance) {
  /**
   * GET /api/domains/:host/diagnose
   * querystring: path(필수), query(선택), range(선택, '1h'|'24h'|'7d', 기본 '1h')
   * 반환: cdn / origin / cache_copy / response_headers / range / hit_ratio_pct / sample_count
   */
  app.get('/api/domains/:host/diagnose', async (req, reply) => {
    const host = normalizeHost((req.params as { host: string }).host);

    // querystring 검증
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid query' });
    }
    const { path, query, range } = parsed.data;

    // 도메인 존재 확인
    const exists = app.db.prepare('SELECT 1 FROM domains WHERE host = ?').get(host);
    if (!exists) return reply.code(404).send({ error: 'domain not found' });

    const key = cacheKey(host, path, query);
    const fullUrl = `https://${host}${path}${query ? `?${query}` : ''}`;
    const periodSec = PERIOD_SEC[range];

    // proxy /diagnose 호출 (부분 실패 허용 — cdn 필드만 null 처리)
    let cdnPayload: unknown = null;
    try {
      const resp = await axios.get(`${app.proxyAdminUrl}/diagnose`, {
        params: { key }, timeout: 1500,
      });
      cdnPayload = resp.data;
    } catch (e) {
      req.log.warn({ err: e }, 'proxy /diagnose 호출 실패 — cdn 필드 null');
    }

    // storage GetMetadata RPC 호출 (부분 실패 허용 — cache_copy / response_headers null 처리)
    let metaPayload: {
      exists: boolean; size_bytes: number; stored_at: number; expires_at: number;
      content_type: string; cached_headers: Array<{ name: string; value: string }>;
    } | null = null;
    try {
      metaPayload = await app.storageClient.getMetadata(key);
    } catch (e) {
      req.log.warn({ err: e }, 'storage getMetadata 호출 실패 — cache_copy/headers null');
    }

    // optimization_events 집계 — 로컬 DB이므로 항상 성공 (실패 시 0 값 집계 반환)
    const agg = app.optimizationEventsRepo.diagnoseAggregate({ host, url: fullUrl, periodSec });

    return reply.send({
      cdn: cdnPayload,
      origin: {
        status:        originStatus(agg.error_5xx, agg.timeout_count, agg.origin_sample_count),
        avg_rtt_ms:    agg.avg_origin_rtt_ms,
        error_5xx:     agg.error_5xx,
        timeout_count: agg.timeout_count,
        sample_count:  agg.origin_sample_count,
      },
      cache_copy: metaPayload === null ? null : {
        exists:     metaPayload.exists,
        size_bytes: metaPayload.size_bytes,
        stored_at:  metaPayload.stored_at,
        expires_at: metaPayload.expires_at,
      },
      response_headers: metaPayload === null ? null : metaPayload.cached_headers,
      range: {
        single_count: agg.range_single_count,
        multi_count:  agg.range_multi_count,
        none_count:   agg.range_none_count,
      },
      hit_ratio_pct: agg.hit_ratio_pct,
      sample_count:  agg.sample_count,
    });
  });
}
