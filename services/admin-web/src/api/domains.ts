/// 도메인 관리 API 클라이언트
import axios from 'axios';
import type {
  Domain,
  DomainSummary,
  DomainHostSummary,
  DomainStats,
  DomainLog,
  BulkAddResult,
  DomainsFilter,
} from './domain-types';

export type { Domain };

/** 전체 도메인 목록 조회 (필터 선택) */
export async function fetchDomains(filter?: DomainsFilter): Promise<Domain[]> {
  const res = await axios.get<Domain[]>('/api/domains', { params: filter });
  return res.data;
}

/** 단일 도메인 조회 */
export async function fetchDomain(host: string): Promise<Domain> {
  const res = await axios.get<Domain>(`/api/domains/${encodeURIComponent(host)}`);
  return res.data;
}

/** 도메인 요약 통계 조회 */
export async function fetchDomainSummary(): Promise<DomainSummary> {
  const res = await axios.get<DomainSummary>('/api/domains/summary');
  return res.data;
}

/** 도메인 추가 (이미 있으면 origin 갱신) */
export async function addDomain(host: string, origin: string): Promise<Domain> {
  const res = await axios.post<Domain>('/api/domains', { host, origin });
  return res.data;
}

/** 도메인 편집 */
export async function updateDomain(
  host: string,
  body: Partial<Pick<Domain, 'origin' | 'enabled' | 'description'>>,
): Promise<Domain> {
  const res = await axios.put<Domain>(`/api/domains/${encodeURIComponent(host)}`, body);
  return res.data;
}

/** 도메인 활성/비활성 토글 */
export async function toggleDomain(host: string): Promise<Domain> {
  const res = await axios.post<Domain>(`/api/domains/${encodeURIComponent(host)}/toggle`);
  return res.data;
}

/** 도메인 캐시 퍼지 */
export async function purgeDomain(host: string): Promise<void> {
  await axios.post(`/api/domains/${encodeURIComponent(host)}/purge`);
}

/** 도메인 삭제 */
export async function deleteDomain(host: string): Promise<void> {
  await axios.delete(`/api/domains/${encodeURIComponent(host)}`);
}

/** 도메인 일괄 추가 */
export async function bulkAddDomains(
  domains: Array<{ host: string; origin: string }>,
): Promise<BulkAddResult> {
  const res = await axios.post<BulkAddResult>('/api/domains/bulk', { domains });
  return res.data;
}

/** 도메인 일괄 삭제 */
export async function bulkDeleteDomains(hosts: string[]): Promise<{ deleted: number }> {
  const res = await axios.delete<{ deleted: number }>('/api/domains/bulk', { data: { hosts } });
  return res.data;
}

/** 단일 도메인 요약 통계 조회 — L1/Edge/Bypass 비율 포함 */
export async function fetchDomainHostSummary(host: string): Promise<DomainHostSummary> {
  const res = await axios.get<DomainHostSummary>(
    `/api/domains/${encodeURIComponent(host)}/summary`,
  );
  return res.data;
}

/** 기간 타입 — 1h/24h/7d/30d 고정 또는 custom(from/to 직접 지정) */
export type StatsPeriod = '1h' | '24h' | '7d' | '30d' | 'custom';

/** 도메인 기간별 통계 조회 — 1h/custom(from·to) 지원 확장 */
export async function fetchDomainStats(
  host: string,
  period: StatsPeriod,
  range?: { from: number; to: number },
): Promise<DomainStats> {
  const params: Record<string, string | number> = { period };
  if (period === 'custom' && range) {
    params.from = range.from;
    params.to = range.to;
  }
  const res = await axios.get<DomainStats>(
    `/api/domains/${encodeURIComponent(host)}/stats`,
    { params },
  );
  return res.data;
}

/** 도메인 로그 조회 옵션 — 기간/상태/캐시/검색 필터 포함 */
export interface DomainLogsOptions {
  limit?: number;
  offset?: number;
  status?: '5xx' | '4xx';
  cache?: 'hit' | 'miss';
  q?: string;
  period?: StatsPeriod;
  from?: number;
  to?: number;
}

/** 도메인 요청 로그 조회 — 기간 필터 및 다양한 검색 옵션 지원 */
export async function fetchDomainLogs(
  host: string,
  options?: DomainLogsOptions,
): Promise<DomainLog[]> {
  const res = await axios.get<DomainLog[]>(
    `/api/domains/${encodeURIComponent(host)}/logs`,
    { params: options },
  );
  return res.data;
}
