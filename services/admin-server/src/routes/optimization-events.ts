/// 최적화 이벤트 관찰 API 라우트
/// Phase 13/14/15가 공용으로 쓰는 optimization_events 테이블을 읽고 쓴다.
///
/// 엔드포인트:
///  - POST /internal/events/batch  → proxy가 주기적으로 호출하는 배치 인입 (nginx 미프록시)
///  - GET  /api/optimization/events → 관리자/대시보드 조회 (nginx 프록시)
///  - GET  /api/optimization/stats  → decision별 집계 (nginx 프록시)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OptimizationEventsRepository,
  type OptimizationEventInput,
  type OptimizationEventType,
} from '../db/optimization-events-repo.js';

/** 허용 event_type — 화이트리스트 밖이면 400 */
const ALLOWED_EVENT_TYPES: ReadonlySet<OptimizationEventType> = new Set([
  'media_cache', 'image_optimize', 'text_compress',
]);

/**
 * 허용 decision 화이트리스트 — Phase 13/14/15 + 공통 bypass의 합집합.
 * GET /api/optimization/events / /api/optimization/stats가 받는 `decision` 쿼리에 적용.
 * 없는 값을 받으면 SQL exact match에서 silent 0건이 되어 운영자가 "필터가 안 먹는다 / 데이터가 진짜 없다"를
 * 구분할 수 없으므로 (#318), since/period(#300)와 동일하게 400으로 거부한다.
 *
 * 정의는 `db/optimization-events-repo.ts` 헤더 주석 + proxy/optimizer-service의 emit 경로와 일치한다.
 */
export const ALLOWED_DECISIONS: ReadonlySet<string> = new Set([
  // media_cache
  'served_200', 'served_206', 'stored_new', 'invalid_range_416',
  // image_optimize (optimizer-service의 OptimizeDecision::as_str)
  'optimized', 'passthrough_larger', 'passthrough_error', 'passthrough_unsupported',
  // image_optimize 추가 분류 (rejected/skipped/error)
  'converted', 'rejected_size', 'skipped_small', 'skipped_type', 'error',
  // text_compress (proxy compress 경로)
  'compressed_br', 'compressed_gzip',
  // 공통 bypass — proxy lib.rs / events.rs에서 발행
  'bypass_nocache', 'bypass_size', 'bypass_method', 'bypass_other',
]);

/** period 문자열 → 초 매핑. 기본 24시간. */
const PERIOD_TO_SEC: Record<string, number> = {
  '1h':  3600,
  '24h': 86400,
  '7d':  86400 * 7,
  '30d': 86400 * 30,
};

/**
 * host 쿼리 파라미터 정규화.
 * 도메인 테이블이 lowercase로 정규화 저장(#201)되므로 조회 시에도 동일 규칙 적용 — `HTTPBIN.ORG`/` httpbin.org `도
 * `httpbin.org` 이벤트와 매칭되도록 한다. 다른 라우트(domains/tls/cache)의 normalizeHost와 동일 패턴(#296/#297).
 * 빈 문자열은 undefined로 다뤄 필터를 비활성화한다.
 */
function normalizeHostQuery(input: string | undefined): string | undefined {
  if (typeof input !== 'string') return undefined;
  const v = input.trim().toLowerCase();
  return v.length > 0 ? v : undefined;
}

/**
 * 배치 인입 단일 이벤트 zod 스키마 — host/url/decision/elapsed_ms 등 필드 무검증으로 인한
 * 비정상 row INSERT를 막는다 (#364). GET 라우트의 `decision` 화이트리스트(#318)와 동일한
 * ALLOWED_DECISIONS·ALLOWED_EVENT_TYPES를 적용해 query/ingest 정책을 일치시킨다.
 *  - host/url: 빈 문자열 거부 (DB schema는 NOT NULL이지만 ''는 통과시키므로 런타임에서 차단)
 *  - decision: 화이트리스트 밖 값 거부 (proxy/optimizer-service emit 값과 동기 — repo 헤더 주석 참조)
 *  - orig_size/out_size: 음수 거부, null·undefined 허용 (bypass 케이스 보존)
 *  - elapsed_ms: 음수 거부 (better-sqlite3는 -1도 INSERT 허용하므로 런타임에서 차단)
 */
// 이슈 #405 — 인입 host 정규화. proxy 측이 raw Host 헤더(mixed case, port, trailing dot)를
// 보내도 admin 저장 시점에 lowercase·port 제거·trailing dot 제거를 거쳐 diagnoseAggregate 의
// lowercase WHERE 매치에서 누락되지 않게 한다. proxy/lib.rs `normalize_host` 와 동일 규칙.
function normalizeEventHost(raw: string): string {
  const noPort = raw.split(':')[0] ?? raw;
  return noPort.replace(/\.+$/, '').toLowerCase();
}

const eventInputSchema = z.object({
  ts:           z.string().optional(),
  event_type:   z.enum(['media_cache', 'image_optimize', 'text_compress']),
  host:         z.string().min(1).transform(normalizeEventHost),
  url:          z.string().min(1),
  decision:     z.string().refine((d) => ALLOWED_DECISIONS.has(d), {
    message: 'invalid decision',
  }),
  orig_size:    z.number().int().nonnegative().nullable().optional(),
  out_size:     z.number().int().nonnegative().nullable().optional(),
  range_header: z.string().nullable().optional(),
  content_type: z.string().nullable().optional(),
  elapsed_ms:   z.number().int().nonnegative(),
});

/**
 * 배치 전체 스키마 — 한 번의 호출에서 너무 많은 이벤트가 들어오면 INSERT 트랜잭션이 길어져
 * admin-server 응답이 지연되므로 1000건으로 상한을 둔다 (proxy 측 배치 크기와 정합).
 */
const eventBatchSchema = z.object({
  events: z.array(eventInputSchema).max(1000),
});

export async function optimizationEventsRoutes(app: FastifyInstance) {
  const repo = new OptimizationEventsRepository(app.db);

  /**
   * 내부 배치 인입 엔드포인트 — proxy만 호출.
   * nginx 설정에서 `/api/*`만 외부에 노출하므로 `/internal/*`은 docker 네트워크 안에서만 접근 가능.
   *
   * 이벤트 한 건이라도 스키마 위반이면 전체 거절 (현재 정책 보존). proxy 측 emit 코드가
   * 비정상 페이로드(host/url 누락, 음수 elapsed_ms, 화이트리스트 밖 decision)를 보내면
   * 무성공/무경고로 invariant가 깨진 row가 누적되던 #364 회귀를 막는다.
   */
  app.post(
    '/internal/events/batch',
    async (req, reply) => {
      const parsed = eventBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        // 표준 envelope (#327) — dns/cache 라우트와 동일하게 issues 동봉
        return reply.status(400).send({
          error: 'invalid_input',
          issues: parsed.error.issues,
        });
      }
      const inserted = repo.insertBatch(parsed.data.events as OptimizationEventInput[]);
      return { inserted };
    },
  );

  /**
   * 이벤트 조회 — 디버깅/대시보드 상세 탭용. 필터와 limit는 repo.query에 위임.
   * since는 ISO 8601 형식만 허용 — 잘못된 값은 SQL string 비교에서 silent 0건으로 빠지므로 (#300)
   * dns/cache 라우트와 동일하게 400으로 거부해 운영자 혼란을 막는다.
   */
  app.get<{
    Querystring: { type?: string; host?: string; decision?: string; since?: string; limit?: string };
  }>('/api/optimization/events', async (req, reply) => {
    // type 화이트리스트 검증 — 빈 문자열/미지정은 필터 비활성, 그 외 모르는 값은 400 거부 (#318).
    // since/period(#300)와 정책을 통일해 silent 0건 혼란을 막는다.
    const typeRaw = req.query.type;
    if (typeRaw !== undefined && typeRaw !== ''
        && !ALLOWED_EVENT_TYPES.has(typeRaw as OptimizationEventType)) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_type',
        message: `invalid type: ${typeRaw}`,
      });
    }
    // decision 화이트리스트 검증 — type과 동일 정책 (#318)
    const decisionRaw = req.query.decision;
    if (decisionRaw !== undefined && decisionRaw !== ''
        && !ALLOWED_DECISIONS.has(decisionRaw)) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_decision',
        message: `invalid decision: ${decisionRaw}`,
      });
    }
    // since가 들어왔다면 ISO 8601 파싱 가능해야 함 — 'Invalid Date'면 거부
    const sinceRaw = req.query.since;
    if (sinceRaw !== undefined && sinceRaw !== '') {
      const d = new Date(sinceRaw);
      if (Number.isNaN(d.getTime())) {
        // 표준 envelope (#327)
        return reply.status(400).send({
          error: 'invalid_since',
          message: `invalid since: ${sinceRaw}`,
        });
      }
    }
    // limit 검증 — #415: 빈 문자열·비숫자·음수·0·소수·범위 초과 모두 silent fallback 대신 400 invalid_input.
    //   기존엔 Number.isFinite만 검사하고 repo clampInt에 위임해 '?limit=abc'/'?limit=-1'/'?limit=999999' 가
    //   각각 fallback 100건·min 클램프 1건·max 클램프 1000건으로 silent 변환됐다 (#408 정책 위반).
    //   /api/cache/popular·/api/dns/queries 와 동일하게 z.coerce.number().int().min(1).max(1000) 정책 통일.
    const limitRaw = req.query.limit;
    let limitNum: number | undefined;
    if (limitRaw !== undefined && limitRaw !== '') {
      const parsed = z.coerce.number().int().min(1).max(1000).safeParse(limitRaw);
      if (!parsed.success) {
        // 표준 envelope (#327/#410)
        return reply.status(400).send({
          error: 'invalid_input',
          message: `limit must be an integer in [1, 1000] (received: "${limitRaw}")`,
          issues: parsed.error.issues,
        });
      }
      limitNum = parsed.data;
    }
    const events = repo.query({
      event_type: typeRaw !== '' ? typeRaw : undefined,
      host:       normalizeHostQuery(req.query.host),
      decision:   decisionRaw !== '' ? decisionRaw : undefined,
      since:      sinceRaw,
      limit:      limitNum,
    });
    return { events };
  });

  /**
   * decision별 집계 — 대시보드 카드/차트용. period는 '1h'/'24h'/'7d'/'30d' 중 하나여야 한다.
   * 화이트리스트 밖이면 dns/cache의 range 라우트와 동일하게 400 거부 (#300) — 잘못된 값에 대한
   * silent 24h fallback은 "기간 변경이 안 먹는다"는 운영자 혼란을 유발하므로 정책을 통일한다.
   */
  app.get<{
    Querystring: { type?: string; host?: string; period?: string };
  }>('/api/optimization/stats', async (req, reply) => {
    // type 화이트리스트 검증 — events 라우트와 동일 정책 (#318).
    // 잘못된 type이 들어오면 silent 0건 집계가 되어 "기간/타입 변경이 안 먹는다"는 운영자 혼란을 유발.
    const typeRaw = req.query.type;
    if (typeRaw !== undefined && typeRaw !== ''
        && !ALLOWED_EVENT_TYPES.has(typeRaw as OptimizationEventType)) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_type',
        message: `invalid type: ${typeRaw}`,
      });
    }
    const period = req.query.period ?? '24h';
    const period_sec = PERIOD_TO_SEC[period];
    if (period_sec === undefined) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_period',
        message: `invalid period: ${period}`,
      });
    }
    const by_decision = repo.statsByDecision({
      event_type: typeRaw !== '' ? typeRaw : undefined,
      host:       normalizeHostQuery(req.query.host),
      period_sec,
    });
    const total = by_decision.reduce((s, r) => s + r.count, 0);
    return { period_sec, total, by_decision };
  });
}
