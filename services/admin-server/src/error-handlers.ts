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

  // 일반 에러 핸들러 — Fastify schema validation / 미잡힌 throw 처리
  app.setErrorHandler((err: FastifyError, req, reply) => {
    // Fastify JSON Schema 검증 실패 (err.validation 배열 존재)
    if (err.validation) {
      return reply.code(err.statusCode ?? 400).send({
        error: 'invalid_input',
        message: err.message,
        issues: err.validation,
      } satisfies ApiError);
    }

    // rate-limit 등 fastify 플러그인은 err.statusCode 를 명시한다.
    const status = err.statusCode ?? 500;

    // 5xx — 서버 내부 오류는 로그를 남기고 메시지는 노출하되 code는 일반화
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(status).send({
        error: 'internal_error',
        message: err.message,
      } satisfies ApiError);
    }

    // 4xx — err.code(예: FST_ERR_RATE_LIMIT)를 머신 코드로 사용, 메시지는 그대로
    return reply.code(status).send({
      error: err.code ?? 'request_error',
      message: err.message,
    } satisfies ApiError);
  });
}
