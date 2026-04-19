/// optimizationEventsRoutes 테스트
/// in-memory SQLite + Fastify inject로 HTTP 레벨 동작을 검증한다.
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { optimizationEventsRoutes } from './optimization-events.js';
import { OPTIMIZATION_EVENTS_SCHEMA } from '../db/optimization-events-repo.js';

/** 테스트용 Fastify 앱 — in-memory SQLite 데코레이터 주입 + 라우트 등록 */
function mkApp() {
  const db = new Database(':memory:');
  db.exec(OPTIMIZATION_EVENTS_SCHEMA);
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('db', db as any);
  app.register(optimizationEventsRoutes);
  return { app, db };
}

/** 기본 이벤트 payload 팩토리 */
const sampleEvent = (over: Record<string, unknown> = {}) => ({
  event_type:   'media_cache',
  host:         'webdt.edunet.net',
  url:          'https://webdt.edunet.net/p34.mp4',
  decision:     'served_206',
  orig_size:    1000,
  out_size:     100,
  range_header: 'bytes=0-99',
  content_type: 'video/mp4',
  elapsed_ms:   4,
  ...over,
});

// ─── POST /internal/events/batch ───────────────────────────────────────────
describe('POST /internal/events/batch', () => {
  it('여러 이벤트를 저장하고 insert 개수를 반환', async () => {
    const { app } = mkApp();
    const res = await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [sampleEvent(), sampleEvent({ decision: 'stored_new' })] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 2 });
  });

  it('events 필드가 배열이 아니면 400', async () => {
    const { app } = mkApp();
    const res = await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: 'oops' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('events 필드 자체가 없으면 400', async () => {
    const { app } = mkApp();
    const res = await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('event_type이 화이트리스트 밖이면 400', async () => {
    const { app } = mkApp();
    const res = await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [sampleEvent({ event_type: 'unknown' })] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('빈 배열이면 0 반환', async () => {
    const { app } = mkApp();
    const res = await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 0 });
  });
});

// ─── GET /api/optimization/events ──────────────────────────────────────────
describe('GET /api/optimization/events', () => {
  it('저장된 이벤트를 ts 내림차순으로 반환', async () => {
    const { app } = mkApp();
    await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [
        sampleEvent({ url: 'https://a.test/1.mp4', decision: 'served_206' }),
        sampleEvent({ url: 'https://a.test/2.mp4', decision: 'stored_new' }),
      ] },
    });

    const res = await app.inject({ method: 'GET', url: '/api/optimization/events' });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(2);
  });

  it('type + host + decision 필터 동작', async () => {
    const { app } = mkApp();
    await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [
        sampleEvent({ host: 'a.test', decision: 'served_206'    }),
        sampleEvent({ host: 'b.test', decision: 'served_206'    }),
        sampleEvent({ host: 'a.test', decision: 'stored_new'    }),
      ] },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/optimization/events?type=media_cache&host=a.test&decision=served_206',
    });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].host).toBe('a.test');
    expect(body.events[0].decision).toBe('served_206');
  });

  it('limit 파라미터 적용', async () => {
    const { app } = mkApp();
    await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: Array.from({ length: 20 }).map((_, i) => sampleEvent({ url: `https://a.test/${i}` })) },
    });
    const res = await app.inject({ method: 'GET', url: '/api/optimization/events?limit=5' });
    expect(res.json().events).toHaveLength(5);
  });
});

// ─── GET /api/optimization/stats ───────────────────────────────────────────
describe('GET /api/optimization/stats', () => {
  it('decision별 건수와 total·period_sec 반환', async () => {
    const { app } = mkApp();
    await app.inject({
      method: 'POST', url: '/internal/events/batch',
      headers: { 'content-type': 'application/json' },
      payload: { events: [
        sampleEvent({ decision: 'served_206' }),
        sampleEvent({ decision: 'served_206' }),
        sampleEvent({ decision: 'bypass_nocache' }),
      ] },
    });

    const res = await app.inject({ method: 'GET', url: '/api/optimization/stats?period=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.period_sec).toBe(86400);
    const s206 = body.by_decision.find((r: { decision: string }) => r.decision === 'served_206');
    expect(s206.count).toBe(2);
  });

  it('모르는 period 문자열이면 기본(24h) 적용', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/optimization/stats?period=5y' });
    expect(res.statusCode).toBe(200);
    expect(res.json().period_sec).toBe(86400);
  });

  it('period=1h로 요청하면 period_sec=3600', async () => {
    const { app } = mkApp();
    const res = await app.inject({ method: 'GET', url: '/api/optimization/stats?period=1h' });
    expect(res.json().period_sec).toBe(3600);
  });
});
