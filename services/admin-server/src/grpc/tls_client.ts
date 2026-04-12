// TLS gRPC 클라이언트 — tls-service:50052 연동
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_BASE = process.env.PROTO_BASE_PATH
  ?? path.resolve(new URL('.', import.meta.url).pathname, '../../../../crates/cdn-proto/proto');

type GrpcConstructor = new (url: string, creds: grpc.ChannelCredentials) => grpc.Client;

function loadClient(protoFile: string, servicePath: string): GrpcConstructor {
  const pkg = protoLoader.loadSync(path.join(PROTO_BASE, protoFile), {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const def = grpc.loadPackageDefinition(pkg) as Record<string, unknown>;
  const parts = servicePath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svc: any = def;
  for (const p of parts) svc = svc[p];
  return svc as GrpcConstructor;
}

function call<T>(client: grpc.Client, method: string, req: object): Promise<T> {
  return new Promise((resolve, reject) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)[method](req, (err: Error | null, res: T) => err ? reject(err) : resolve(res)),
  );
}

export interface CertInfo { domain: string; issued_at: string; expires_at: string; status: string; }
export interface DomainEntry { host: string; origin: string; }

export function createTlsClient(url: string) {
  const TlsService = loadClient('tls.proto', 'cdn.tls.TlsService');
  const client = new TlsService(url, grpc.credentials.createInsecure());
  return {
    getCACert:        ()                       => call<{ cert_pem: string }>(client, 'GetCACert', {}),
    getMobileconfig:  ()                       => call<{ cert_pem: string }>(client, 'GetCACert', {}),
    listCertificates: ()                       => call<{ certs: CertInfo[] }>(client, 'ListCertificates', {}),
    syncDomains:      (domains: DomainEntry[]) => call<{ success: boolean }>(client, 'SyncDomains', { domains }),
    health:           ()                       => call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
  };
}

export type TlsClient = ReturnType<typeof createTlsClient>;
