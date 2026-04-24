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

export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Host-session' : 'session';

export function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: TTL_SECONDS,
  };
}
