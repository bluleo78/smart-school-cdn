/// 도메인 관리 API 클라이언트
import axios from 'axios';

/** 도메인 한 건 */
export interface Domain {
  host: string;
  origin: string;
  created_at: number;
}

/** 전체 도메인 목록 조회 */
export async function fetchDomains(): Promise<Domain[]> {
  const res = await axios.get<Domain[]>('/api/domains');
  return res.data;
}

/** 도메인 추가 (이미 있으면 origin 갱신) */
export async function addDomain(host: string, origin: string): Promise<Domain> {
  const res = await axios.post<Domain>('/api/domains', { host, origin });
  return res.data;
}

/** 도메인 삭제 */
export async function deleteDomain(host: string): Promise<void> {
  await axios.delete(`/api/domains/${encodeURIComponent(host)}`);
}
