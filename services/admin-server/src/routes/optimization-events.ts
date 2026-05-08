/// 최적화 이벤트 관찰 API 라우트
/// Phase 13/14/15가 공용으로 쓰는 optimization_events 테이블을 읽고 쓴다.
///
/// 엔드포인트:
///  - POST /internal/events/batch  → proxy가 주기적으로 호출하는 배치 인입 (nginx 미프록시)
///  - GET  /api/optimization/events → 관리자/대시보드 조회 (nginx 프록시)
///  - GET  /api/optimization/stats  → decision별 집계 (nginx 프록시)
import type { FastifyInstance } from 'fastify';
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
const ALLOWED_DECISIONS: ReadonlySet<string> = new Set([
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

export async function optimizationEventsRoutes(app: FastifyInstance) {
  const repo = new OptimizationEventsRepository(app.db);

  /**
   * 내부 배치 인입 엔드포인트 — proxy만 호출.
   * nginx 설정에서 `/api/*`만 외부에 노출하므로 `/internal/*`은 docker 네트워크 안에서만 접근 가능.
   */
  app.post<{ Body: { events?: OptimizationEventInput[] } }>(
    '/internal/events/batch',
    async (req, reply) => {
      const events = req.body?.events;
      if (!Array.isArray(events)) {
        // 표준 envelope (#327)
        return reply.status(400).send({
          error: 'invalid_input',
          message: 'events 배열 필수',
        });
      }
      // event_type 화이트리스트 검증 — 모르는 타입이 하나라도 섞이면 전체 거절
      for (const ev of events) {
        if (!ALLOWED_EVENT_TYPES.has(ev.event_type as OptimizationEventType)) {
          // 표준 envelope (#327)
          return reply.status(400).send({
            error: 'invalid_input',
            message: `unknown event_type: ${ev.event_type}`,
          });
        }
      }
      const inserted = repo.insertBatch(events);
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
    const limitNum = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const events = repo.query({
      event_type: typeRaw !== '' ? typeRaw : undefined,
      host:       normalizeHostQuery(req.query.host),
      decision:   decisionRaw !== '' ? decisionRaw : undefined,
      since:      sinceRaw,
      limit:      Number.isFinite(limitNum) ? (limitNum as number) : undefined,
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
