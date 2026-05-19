// 에러 응답 envelope 통일 (#175)
// admin-server의 모든 비-2xx 응답이 다음 단일 형태를 따르도록 한다:
//   { error: '<machine_code>', message?: '<사용자 표시용>', issues?: ZodIssue[] }
// - 라우트 핸들러가 직접 작성한 `reply.code(...).send({ error: '...' })` 응답은
//   이미 `{ error: string }` 형태이므로 그대로 둔다 (점진적 통일).
// - 여기서는 (1) 라우트 미존재 (2) Fastify 스키마 검증 실패 (3) 미잡힌 throw 의
//   세 가지 시스템적 케이스를 envelope에 맞춘다.
import type { FastifyError, FastifyInstance } from 'fastify';

/** admin-server 표준 에러 응답 envelope */
export type ApiError = {
  error: string;
  message?: string;
  // zod 또는 Fastify schema validation 결과
  issues?: unknown;
};

/**
 * 표준 에러 핸들러를 Fastify 인스턴스에 등록한다.
 * index.ts 부트스트랩과 라우트 단위 통합 테스트(buildApp) 양쪽에서 사용한다.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  // 404 — Fastify 기본 핸들러는 `{ message, error, statusCode }` 형태라
  // 다른 핸들러와 모양이 다르다. envelope에 맞춰 재작성한다.
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: 'not_found',
      message: `Route ${req.method}:${req.url} not found`,
    } satisfies ApiError);
  });

  // 일반 에러 핸들러 — Fastify schema validation / 미잡힌 throw 처리.
  // 이슈 #366 — 모든 에러 경로에 표준 로그 필드(error_kind/route/req_id) 부여.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const route = req.routeOptions?.url ?? req.url;

    // Fastify JSON Schema 검증 실패 (err.validation 배열 존재)
    if (err.validation) {
      const status = err.statusCode ?? 400;
      req.log.warn({ error_kind: 'invalid_input', route, req_id: req.id, status }, 'validation error');
      return reply.code(status).send({
        error: 'invalid_input',
        message: err.message,
        issues: err.validation,
      } satisfies ApiError);
    }

    // (#347) 잘못된 percent-encoding(`%`, `%2`, `%25` 등) 으로 라우트 핸들러 내부
    // decodeURIComponent 가 던진 URIError 는 클라이언트 입력 오류이므로 500이 아닌 400으로 표준화한다.
    if (err instanceof URIError || err.name === 'URIError') {
      req.log.warn({ error_kind: 'invalid_input', route, req_id: req.id, status: 400 }, 'URI decode error');
      return reply.code(400).send({
        error: 'invalid_input',
        message: '요청 경로의 인코딩이 올바르지 않습니다.',
      } satisfies ApiError);
    }

    // rate-limit 등 fastify 플러그인은 err.statusCode 를 명시한다.
    const status = err.statusCode ?? 500;

    // 5xx — 서버 내부 오류는 error 레벨로 로그 + error_kind=internal_error
    if (status >= 500) {
      req.log.error({ err, error_kind: 'internal_error', route, req_id: req.id, status }, 'unhandled error');
      return reply.code(status).send({
        error: 'internal_error',
        message: err.message,
      } satisfies ApiError);
    }

    // 4xx — err.code(예: FST_ERR_RATE_LIMIT)를 머신 코드로 사용. error_kind 도 같은 값으로 통일.
    const errorKind = err.code ?? 'request_error';
    req.log.warn({ error_kind: errorKind, route, req_id: req.id, status }, '4xx error');
    return reply.code(status).send({
      error: errorKind,
      message: err.message,
    } satisfies ApiError);
  });
}
