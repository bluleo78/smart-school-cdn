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

export async function listUsers(): Promise<UserItem[]> {
  return (await api.get<UserItem[]>('/users')).data;
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
