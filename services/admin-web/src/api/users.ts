/** 사용자 관리 API 래퍼 — admin 전용 CRUD 호출 */
import { api } from '../lib/api';

/**
 * 사용자 목록 응답 타입.
 * - 타임스탬프 필드는 INTEGER unix seconds (#342) — domains·optimization_events 와 동일 표준.
 *   `new Date(ts * 1000)` 으로 Date 객체 생성. 0/null 은 "미설정/이벤트 없음" 의미.
 */
export interface UserItem {
  id: number;
  username: string;
  created_at: number;
  updated_at: number;
  disabled_at: number | null;
  last_login_at: number | null;
}

/** listUsers 옵션 — 이슈 #348. 모든 필드 optional, 기본 동작은 종전과 동일. */
export interface ListUsersOptions {
  q?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

/** 페이지네이션 응답 — limit/offset 전달 시 서버가 {users, total} 로 응답 */
export interface UserListPage {
  users: UserItem[];
  total: number;
}

/**
 * 사용자 목록 조회 — 이슈 #348.
 * - limit/offset 둘 다 미지정: 종전과 동일하게 평탄 배열 반환
 * - limit/offset 중 하나라도 지정: 페이지 응답 {users, total} 반환
 */
export async function listUsers(opts?: ListUsersOptions): Promise<UserItem[] | UserListPage> {
  const params: Record<string, string> = {};
  if (opts?.q && opts.q.length > 0) params.q = opts.q;
  if (opts?.enabled !== undefined) params.enabled = String(opts.enabled);
  if (opts?.sort) params.sort = opts.sort;
  if (opts?.order) params.order = opts.order;
  if (opts?.limit !== undefined) params.limit = String(opts.limit);
  if (opts?.offset !== undefined) params.offset = String(opts.offset);
  const r = await api.get<UserItem[] | UserListPage>('/users', { params });
  return r.data;
}

export async function createUser(username: string, password: string): Promise<UserItem> {
  return (await api.post<UserItem>('/users', { username, password })).data;
}

/** 비밀번호 변경. 자기 자신 변경 시 currentPassword 필수 (이슈 #31) */
export async function updatePassword(id: number, password: string, currentPassword?: string): Promise<void> {
  await api.put(`/users/${id}/password`, { password, ...(currentPassword !== undefined ? { currentPassword } : {}) });
}

export async function disableUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}

/** 비활성화된 사용자를 재활성화한다 */
export async function enableUser(id: number): Promise<void> {
  await api.put(`/users/${id}/enable`, {});
}
