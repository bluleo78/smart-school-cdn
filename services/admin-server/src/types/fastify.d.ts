// Fastify 인스턴스 타입 확장 — gRPC 클라이언트 데코레이터 선언
import type { StorageClient } from '../grpc/storage_client.js';
import type { TlsClient } from '../grpc/tls_client.js';
import type { DnsClient } from '../grpc/dns_client.js';
import type { OptimizerClient } from '../grpc/optimizer_client.js';

declare module 'fastify' {
  interface FastifyInstance {
    storageClient:   StorageClient;
    tlsClient:       TlsClient;
    dnsClient:       DnsClient;
    optimizerClient: OptimizerClient;
    proxyAdminUrl:   string;
  }
}
