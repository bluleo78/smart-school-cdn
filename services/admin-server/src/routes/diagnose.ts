/// URL 진단 라우트 (#387)
/// host(path param) + path/query/range(query string) 를 받아 proxy admin `/diagnose`,
/// storage `GetMetadata`, admin-server 의 `optimization_events` 집계를 fan-in 한다.
/// 부분 실패 시 해당 필드를 null 로 두고 200 을 유지한다 (진단은 진단이 멈추지 않도록).

import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { createHash } from 'node:crypto';

/**
 * querystring 검증 스키마
 *
 * path/query 입력 hygiene — #396 보강:
 * - 제어문자(`\x00-\x1f`, `\x7f`) / 공백 차단: log injection·CRLF 헤더 분리 방지.
 * - fragment(`#`) 차단: 브라우저는 origin 에 fragment 를 보내지 않으므로 캐시 키가 절대 매치되지 않는다 (silent wrong result).
 * - 길이 상한: path 2048 bytes, query 4096 bytes — 캐시 키 폭발·로그 비대화 방지.
 */
// 제어문자 차단을 위해 의도적으로 control char 범위 사용 — eslint no-control-regex 예외 처리.
// eslint-disable-next-line no-control-regex
const PATH_SAFE_RE  = /^\/[^\s#\x00-\x1f\x7f]*$/u;
// eslint-disable-next-line no-control-regex
const QUERY_SAFE_RE = /^[^\s#\x00-\x1f\x7f]*$/u;
const querySchema = z.object({
  path:  z.string()
    .startsWith('/', { message: 'path must start with /' })
    .max(2048, { message: 'path too long (max 2048)' })
    .regex(PATH_SAFE_RE, { message: 'path must not contain whitespace, control chars or #' }),
  query: z.string()
    .max(4096, { message: 'query too long (max 4096)' })
    .regex(QUERY_SAFE_RE, { message: 'query must not contain whitespace, control chars or #' })
    .optional().default(''),
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

    // querystring 검증 — #327 표준 envelope({error: 머신코드, message: 한글})로 응답 (#407)
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? '잘못된 입력입니다.',
        issues: parsed.error.issues,
      });
    }
    const { path, query, range } = parsed.data;

    // 도메인 존재 확인 — 표준 envelope 으로 응답 (#407)
    const exists = app.db.prepare('SELECT 1 FROM domains WHERE host = ?').get(host);
    if (!exists) {
      return reply.code(404).send({
        error: 'domain_not_found',
        message: '도메인을 찾을 수 없습니다.',
      });
    }

    const key = cacheKey(host, path, query);
    // 이슈 #403 — events lookup URL 은 proxy 의 emit 표현과 동일하게 path+query (origin-form).
    // proxy 는 axum 핸들러의 `uri.to_string()` 결과(스킴/호스트 없이 path+query 만)를 그대로 저장하므로
    // 여기도 같은 형태로 hash 해야 url_hash 가 매치되어 sample/range/hit_ratio 가 0 이 아닌 실측치를 반환한다.
    const eventUrl = `${path}${query ? `?${query}` : ''}`;
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
    const agg = app.optimizationEventsRepo.diagnoseAggregate({ host, url: eventUrl, periodSec });

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
