/// DNS 관리 API 클라이언트 — Admin Server의 /api/dns/* 엔드포인트를 호출한다.
/// admin-server 경계에서 uint64/int64 → number 변환이 완료된 상태로 오므로
/// 이 레이어에서는 TypeScript 인터페이스로만 형태를 선언한다.
import axios from 'axios';

/** 상위 도메인 집계(top N) 항목 */
export interface DnsTopDomain {
  qname: string;
  count: number;
}

/** DNS 서비스 상태 + 집계 통계 */
export interface DnsStatus {
  online: boolean;
  uptime_secs: number;
  total: number;
  matched: number;
  nxdomain: number;
  forwarded: number;
  top_domains: DnsTopDomain[];
}

/** DNS 레코드 한 건 (host → target) */
export interface DnsRecord {
  host: string;
  target: string;
  rtype: string;
  source: string;
}

/** 최근 쿼리 결과 분류 라벨 */
export type DnsQueryResultLabel = 'matched' | 'nxdomain' | 'forwarded';

/** 최근 DNS 쿼리 엔트리 */
export interface DnsQueryEntry {
  ts_unix_ms: number;
  client_ip: string;
  qname: string;
  qtype: string;
  result: DnsQueryResultLabel;
  latency_us: number;
}

/** 분/시 단위 메트릭 버킷 */
export interface DnsMetricBucket {
  ts: number;
  total: number;
  matched: number;
  nxdomain: number;
  forwarded: number;
}

/** 메트릭 조회 레인지 — 1시간 또는 24시간 */
export type DnsMetricRange = '1h' | '24h';

/** DNS 서비스 상태 조회 */
export async function fetchDnsStatus(): Promise<DnsStatus> {
  const res = await axios.get<DnsStatus>('/api/dns/status');
  return res.data;
}

/** 현재 등록된 DNS 레코드 전체 조회 */
export async function fetchDnsRecords(): Promise<DnsRecord[]> {
  const res = await axios.get<{ records: DnsRecord[] }>('/api/dns/records');
  return res.data.records;
}

/** 최근 쿼리 로그 조회 (기본 100건) */
export async function fetchDnsQueries(limit = 100): Promise<DnsQueryEntry[]> {
  const res = await axios.get<{ entries: DnsQueryEntry[] }>('/api/dns/queries', {
    params: { limit },
  });
  return res.data.entries;
}

/** 시계열 메트릭 버킷 조회 (1h=분 단위, 24h=시간 단위) */
export async function fetchDnsMetrics(range: DnsMetricRange): Promise<DnsMetricBucket[]> {
  const res = await axios.get<{ buckets: DnsMetricBucket[] }>('/api/dns/metrics', {
    params: { range },
  });
  return res.data.buckets;
}
