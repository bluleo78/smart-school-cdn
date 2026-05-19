/// 이슈 #351 — audit log API wrapper
import { api } from '../lib/api';

export interface AuditEntry {
  id: number;
  actor_user_id: number | null;
  actor_ip: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  created_at: number;  // unix sec
}

export interface AuditQueryParams {
  action?: string;
  actor_user_id?: number;
  target_type?: string;
  target_id?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  rows: AuditEntry[];
  total: number;
}

export async function fetchAudit(q: AuditQueryParams = {}): Promise<AuditPage> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') params[k] = String(v);
  }
  const r = await api.get<AuditPage>('/audit', { params });
  return r.data;
}
