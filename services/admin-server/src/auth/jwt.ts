import jwt from 'jsonwebtoken';

const TTL_SECONDS = 3600;

export interface SessionClaims {
  sub: string;
  username: string;
  iat?: number;
  exp?: number;
}

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET 환경변수 미설정 또는 32자 미만');
  }
  return s;
}

/**
 * HS256 서명 + 1시간 만료.
 */
export function signSessionToken(payload: { sub: string; username: string }): string {
  return jwt.sign(payload, getSecret(), { algorithm: 'HS256', expiresIn: TTL_SECONDS });
}

/**
 * 서명/만료 실패 시 null.
 */
export function verifySessionToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] }) as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * 쿠키 Secure 플래그 사용 여부.
 * - 명시적 `COOKIE_SECURE` 환경변수가 있으면 그 값을 우선 (운영 HTTP 배포에서 false 설정).
 * - 없으면 `NODE_ENV === 'production'` 기준 — 기존 동작 호환.
 * `__Host-` 접두사는 Secure 가 true 일 때만 의미가 있으므로 같은 플래그로 통제한다.
 */
function isCookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE;
  if (v !== undefined) return v === 'true';
  return process.env.NODE_ENV === 'production';
}

export const SESSION_COOKIE_NAME = isCookieSecure() ? '__Host-session' : 'session';

export function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'strict' as const,
    path: '/',
    maxAge: TTL_SECONDS,
  };
}
