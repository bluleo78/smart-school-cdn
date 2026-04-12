// TLS gRPC 클라이언트 — tls-service:50052 연동
import * as grpc from '@grpc/grpc-js';
import { loadClient, call } from './shared.js';

export interface CertInfo { domain: string; issued_at: string; expires_at: string; status: string; }
export interface DomainEntry { host: string; origin: string; }

export function createTlsClient(url: string) {
  const TlsService = loadClient('tls.proto', 'cdn.tls.TlsService');
  const client = new TlsService(url, grpc.credentials.createInsecure());
  return {
    getCACert:        ()                       => call<{ cert_pem: string }>(client, 'GetCACert', {}),
    listCertificates: ()                       => call<{ certs: CertInfo[] }>(client, 'ListCertificates', {}),
    syncDomains:      (domains: DomainEntry[]) => call<{ success: boolean }>(client, 'SyncDomains', { domains }),
    health:           ()                       => call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
  };
}

export type TlsClient = ReturnType<typeof createTlsClient>;
