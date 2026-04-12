// DNS gRPC 클라이언트 — dns-service:50053 연동
import * as grpc from '@grpc/grpc-js';
import { loadClient, call } from './shared.js';

export interface DomainEntry { host: string; origin: string; }

export function createDnsClient(url: string) {
  const DnsService = loadClient('dns.proto', 'cdn.dns.DnsService');
  const client = new DnsService(url, grpc.credentials.createInsecure());
  return {
    syncDomains: (domains: DomainEntry[]) => call<{ success: boolean }>(client, 'SyncDomains', { domains }),
    health:      ()                        => call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
  };
}

export type DnsClient = ReturnType<typeof createDnsClient>;
