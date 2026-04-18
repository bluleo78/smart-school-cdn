// DNS gRPC 클라이언트 — dns-service:50053 연동
import * as grpc from '@grpc/grpc-js';
import { loadClient, call } from './shared.js';

/// 도메인 동기화 엔트리 — host/origin 쌍
export interface DomainEntry { host: string; origin: string; }

/// TopDomain — 상위 질의 도메인 (count는 uint32 → number)
export interface TopDomain { qname: string; count: number; }

/// DNS 통계 응답 — uint64 계열은 proto-loader `longs: String` 설정으로 string
export interface StatsResponse {
  total_queries: string;
  matched: string;
  nxdomain: string;
  forwarded: string;
  uptime_secs: string;
  top_domains: TopDomain[];
}

/// DNS 조회 결과 라벨 — proto `string`로 전달되지만 의미상 enum
export type QueryResultLabel = 'matched' | 'nxdomain' | 'forwarded';

/// 최근 DNS 질의 엔트리 — ts_unix_ms는 int64 → string, latency_us는 uint32 → number
export interface QueryEntry {
  ts_unix_ms: string;
  client_ip: string;
  qname: string;
  qtype: string;
  result: QueryResultLabel;
  latency_us: number;
}
export interface RecentQueriesResponse { entries: QueryEntry[]; }

/// 등록된 DNS 레코드 엔트리 (Phase A: rtype="A", source="auto" 고정)
export interface DnsRecord {
  host: string;
  target: string;
  rtype: string;
  source: string;
}
export interface RecordsResponse { records: DnsRecord[]; }

export function createDnsClient(url: string) {
  const DnsService = loadClient('dns.proto', 'cdn.dns.DnsService');
  const client = new DnsService(url, grpc.credentials.createInsecure());
  return {
    syncDomains:      (domains: DomainEntry[]) =>
      call<{ success: boolean }>(client, 'SyncDomains', { domains }),
    health:           () =>
      call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
    getStats:         () =>
      call<StatsResponse>(client, 'GetStats', {}),
    getRecentQueries: (limit = 100) =>
      call<RecentQueriesResponse>(client, 'GetRecentQueries', { limit }),
    getRecords:       () =>
      call<RecordsResponse>(client, 'GetRecords', {}),
  };
}

export type DnsClient = ReturnType<typeof createDnsClient>;
