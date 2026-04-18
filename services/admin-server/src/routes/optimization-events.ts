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

/** period 문자열 → 초 매핑. 기본 24시간. */
const PERIOD_TO_SEC: Record<string, number> = {
  '1h':  3600,
  '24h': 86400,
  '7d':  86400 * 7,
  '30d': 86400 * 30,
};

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
        return reply.status(400).send({ error: 'events 배열 필수' });
      }
      // event_type 화이트리스트 검증 — 모르는 타입이 하나라도 섞이면 전체 거절
      for (const ev of events) {
        if (!ALLOWED_EVENT_TYPES.has(ev.event_type as OptimizationEventType)) {
          return reply.status(400).send({ error: `unknown event_type: ${ev.event_type}` });
        }
      }
      const inserted = repo.insertBatch(events);
      return { inserted };
    },
  );

  /** 이벤트 조회 — 디버깅/대시보드 상세 탭용. 필터와 limit는 repo.query에 위임 */
  app.get<{
    Querystring: { type?: string; host?: string; decision?: string; since?: string; limit?: string };
  }>('/api/optimization/events', async (req) => {
    const limitNum = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const events = repo.query({
      event_type: req.query.type,
      host:       req.query.host,
      decision:   req.query.decision,
      since:      req.query.since,
      limit:      Number.isFinite(limitNum) ? (limitNum as number) : undefined,
    });
    return { events };
  });

  /** decision별 집계 — 대시보드 카드/차트용. period는 '1h'/'24h'/'7d'/'30d' 중 하나, 모르면 24h */
  app.get<{
    Querystring: { type?: string; host?: string; period?: string };
  }>('/api/optimization/stats', async (req) => {
    const period = req.query.period ?? '24h';
    const period_sec = PERIOD_TO_SEC[period] ?? 86400;
    const by_decision = repo.statsByDecision({
      event_type: req.query.type,
      host:       req.query.host,
      period_sec,
    });
    const total = by_decision.reduce((s, r) => s + r.count, 0);
    return { period_sec, total, by_decision };
  });
}
