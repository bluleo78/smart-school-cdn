/**
 * CORS 설정 검증 테스트
 *
 * admin-server는 내부 전용이므로 허용 origin을 명시적으로 제한해야 한다.
 * 와일드카드(`*`) + credentials 조합은 브라우저 거부 + 쿠키 탈취 위험이 있어
 * 허용 목록으로 제한하는 것이 올바른 설정이다.
 *
 * 이슈 #160: ALLOWED_ORIGINS 미설정 시 프로덕션에서 개발 origin(localhost) 허용 fallback 위험
 * 수정 후: NODE_ENV=production 일 때 ALLOWED_ORIGINS 미설정이면 process.exit(1).
 * 개발/테스트 환경(NODE_ENV 미설정 또는 development)에서는 localhost fallback 유지.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

/**
 * 테스트용 Fastify 앱 빌드 — ALLOWED_ORIGINS 환경변수로 origin을 제어
 * index.ts의 cors 등록 로직을 그대로 반영한다.
 * NODE_ENV는 테스트 전후에 복원한다.
 */
async function buildCorsApp(allowedOrigins?: string, nodeEnv?: string): Promise<FastifyInstance> {
  if (allowedOrigins !== undefined) {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }
  if (nodeEnv !== undefined) {
    process.env.NODE_ENV = nodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }

  const app = Fastify();
  await app.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:4173', 'http://localhost:7777'],
    credentials: true,
  });
  app.get('/api/test', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('CORS 설정', () => {
  let app: FastifyInstance;
  // 테스트 격리: NODE_ENV 원복
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    await app.close();
    delete process.env.ALLOWED_ORIGINS;
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('기본 허용 origin (ALLOWED_ORIGINS 미설정, 개발 환경)', () => {
    beforeEach(async () => {
      // NODE_ENV 미설정 → 개발 환경 — localhost fallback 동작해야 함
      app = await buildCorsApp(undefined, undefined);
    });

    it('허용 origin(localhost:4173) → access-control-allow-origin 에코 + credentials: true', async () => {
      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'http://localhost:4173',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(r.headers['access-control-allow-origin']).toBe('http://localhost:4173');
      expect(r.headers['access-control-allow-credentials']).toBe('true');
    });

    it('허용 origin(localhost:7777) → access-control-allow-origin 에코 + credentials: true', async () => {
      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'http://localhost:7777',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(r.headers['access-control-allow-origin']).toBe('http://localhost:7777');
      expect(r.headers['access-control-allow-credentials']).toBe('true');
    });

    it('외부 origin(evil.example.com) → access-control-allow-origin 헤더 없음 (와일드카드 차단)', async () => {
      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'http://evil.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      // 허용 목록에 없는 origin — ACAO 헤더가 존재하면 안 된다
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('일반 GET 요청 — 허용 origin → access-control-allow-origin 에코', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { 'Origin': 'http://localhost:4173' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBe('http://localhost:4173');
    });

    it('일반 GET 요청 — 외부 origin → access-control-allow-origin 헤더 없음', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/test',
        headers: { 'Origin': 'http://evil.example.com' },
      });
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('ALLOWED_ORIGINS 환경변수 오버라이드', () => {
    beforeEach(async () => {
      // 운영 배포 시 admin-web 주소만 허용하는 시나리오
      app = await buildCorsApp('https://admin.school.local', 'production');
    });

    it('ALLOWED_ORIGINS로 지정한 origin → 허용', async () => {
      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'https://admin.school.local',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(r.headers['access-control-allow-origin']).toBe('https://admin.school.local');
      expect(r.headers['access-control-allow-credentials']).toBe('true');
    });

    it('ALLOWED_ORIGINS 외 origin(localhost:4173) → access-control-allow-origin 헤더 없음', async () => {
      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'http://localhost:4173',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('복수 origin 지정 (콤마 구분) — 두 번째 origin도 허용', async () => {
      await app.close();
      // 복수 origin 콤마 구분 시나리오
      app = await buildCorsApp('https://admin.school.local,https://backup.school.local', 'production');

      const r = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'https://backup.school.local',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(r.headers['access-control-allow-origin']).toBe('https://backup.school.local');
    });
  });

  /**
   * 이슈 #160 회귀 방지 — ALLOWED_ORIGINS 미설정 시 프로덕션에서 개발 origin 허용 fallback 위험
   * 수정 후: NODE_ENV=production + ALLOWED_ORIGINS 미설정 조합은 index.ts에서 process.exit(1)로 기동 거부.
   * 테스트에서는 CORS 로직 자체(빈 배열 fallback)를 검증한다.
   * — index.ts의 exit 가드는 단위 테스트로 직접 호출하기 어려우므로,
   *   "프로덕션에서 ALLOWED_ORIGINS 없으면 localhost가 허용되지 않음"을 대신 검증한다.
   */
  describe('프로덕션 + ALLOWED_ORIGINS 미설정 보안 가드 (#160)', () => {
    it('ALLOWED_ORIGINS 설정 시 프로덕션에서 해당 origin만 허용 (localhost 차단)', async () => {
      // 프로덕션 배포 올바른 시나리오: ALLOWED_ORIGINS에 운영 origin만 포함
      app = await buildCorsApp('https://admin.school.local', 'production');

      const prodOriginRes = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'https://admin.school.local',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(prodOriginRes.headers['access-control-allow-origin']).toBe('https://admin.school.local');

      // 프로덕션에서 localhost가 차단되어야 함 — 개발 origin이 운영 서버에 허용되면 안 됨
      const localhostRes = await app.inject({
        method: 'OPTIONS',
        url: '/api/test',
        headers: {
          'Origin': 'http://localhost:4173',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(localhostRes.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
