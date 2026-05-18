/** 인증 API 래퍼 — /auth/* 엔드포인트 호출용 */
import { api } from '../lib/api';

/** 인증된 사용자 정보. last_login_at 은 INTEGER unix seconds (#342). */
export interface AuthUser {
  id: number;
  username: string;
  last_login_at: number | null;
}

/** 인증 상태 — 초기 진입 시 분기 결정용 */
export type AuthState =
  | { state: 'needs_setup' }
  | { state: 'needs_login' }
  | { state: 'authenticated'; user: AuthUser };

/** 현재 인증 상태 조회 — 부트스트랩 시점에 호출 */
export async function fetchAuthState(): Promise<AuthState> {
  const r = await api.get<AuthState>('/auth/state');
  return r.data;
}

/** 로그인 — 성공 시 HttpOnly 쿠키가 세팅되고 user 반환 */
export async function login(username: string, password: string): Promise<AuthUser> {
  const r = await api.post<{ user: AuthUser }>('/auth/login', { username, password });
  return r.data.user;
}

/**
 * 로그아웃 — 쿠키 무효화.
 * 이슈 #328 이후 서버는 미인증 호출에 401 을 반환한다. 사용자 의도는 "세션 종료" 이므로
 * 401(=이미 종료된 세션) 도 성공으로 간주하고, 그 외 네트워크 오류도 swallow 한다.
 * UI 는 후속 navigate('/login') 으로 로컬 상태를 비우면 그만이라 오류 throw 가 무의미.
 */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 무시 — navigate('/login') 으로 로컬 세션이 정리된다 */
  }
}

/** 최초 관리자 계정 생성 — needs_setup 상태에서만 호출 */
export async function setup(username: string, password: string): Promise<AuthUser> {
  const r = await api.post<{ user: AuthUser }>('/auth/setup', { username, password });
  return r.data.user;
}
