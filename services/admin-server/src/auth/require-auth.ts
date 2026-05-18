import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { verifySessionToken, SESSION_COOKIE_NAME, buildSessionCookieOptions, type SessionClaims } from './jwt.js';
import type { UserRepository } from '../db/user-repo.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionClaims;
  }
}

/**
 * preHandler 훅 팩토리 — JWT 쿠키 기반 인증 + DB 상태 검증 (#330/#331).
 *
 * 무엇을: 매 요청마다 JWT 서명/만료 검증 후, DB 의 users 행을 조회하여
 *  1) `disabled_at` 이 채워져 있으면 차단 (즉시 로그아웃)
 *  2) JWT 의 `tv` claim 과 DB `token_version` 이 불일치하면 차단 (비밀번호 재설정 후 stale 세션)
 * 위 두 케이스 모두 401 응답 + Set-Cookie Max-Age=0 으로 클라이언트 쿠키 삭제.
 *
 * 왜: stateless HS256 JWT 만으로는 비활성화·비밀번호 변경 시 기존 세션을
 *  JWT TTL(현재 1시간)까지 강제 종료할 수 없었다 (#330 #331). DB 한 번 조회 비용을
 *  지불하고 stateful 검증을 추가하여 즉시 차단을 보장한다.
 *
 * 아래 경로는 스킵한다:
 * - /internal/* (별도 requireInternalToken 훅)
 * - /api/health
 * - /api/auth/state, /api/auth/login, /api/auth/setup  (인증 미필요 진입점)
 *
 * /api/auth/logout 은 의도적으로 인증을 거치게 한다 (이슈 #328):
 *   미인증 호출에 200 을 반환하던 기존 동작이 CSRF/로그 위조 노이즈/세션 만료 감지 오용
 *   여지를 만들어, 명시적 화이트리스트 방식으로 좁힌다.
 */
export function createRequireAuth(userRepo: UserRepository): preHandlerHookHandler {
  // 인증 스킵 경로 — 화이트리스트. `/api/auth/*` 통째 스킵 → 명시 목록으로 좁혀 logout 을 보호한다 (#328).
  const AUTH_SKIP_PATHS: ReadonlySet<string> = new Set([
    '/api/auth/state',
    '/api/auth/login',
    '/api/auth/setup',
  ]);

  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const url = req.url;
    // querystring 이 붙은 경로 매칭을 위해 '?' 앞부분만 비교
    const pathOnly = url.split('?', 1)[0];
    if (
      url.startsWith('/internal/') ||
      pathOnly === '/api/health' ||
      AUTH_SKIP_PATHS.has(pathOnly)
    ) {
      return;
    }

    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    const claims = verifySessionToken(token);
    if (!claims) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    // DB 검증 — 비활성화/토큰 버전 mismatch 시 즉시 차단 + 쿠키 삭제 (#330/#331)
    const userId = Number(claims.sub);
    const user = Number.isSafeInteger(userId) ? userRepo.findById(userId) : null;
    if (!user || user.disabled_at !== null || user.token_version !== claims.tv) {
      reply.setCookie(SESSION_COOKIE_NAME, '', { ...buildSessionCookieOptions(), maxAge: 0 });
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    req.user = claims;
  };
}
