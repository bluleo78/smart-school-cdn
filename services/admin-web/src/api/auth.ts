/** 인증 API 래퍼 — /auth/* 엔드포인트 호출용 */
import { api } from '../lib/api';

/** 인증된 사용자 정보 */
export interface AuthUser {
  id: number;
  username: string;
  last_login_at: string | null;
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

/** 로그아웃 — 쿠키 무효화 */
export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

/** 최초 관리자 계정 생성 — needs_setup 상태에서만 호출 */
export async function setup(username: string, password: string): Promise<AuthUser> {
  const r = await api.post<{ user: AuthUser }>('/auth/setup', { username, password });
  return r.data.user;
}
