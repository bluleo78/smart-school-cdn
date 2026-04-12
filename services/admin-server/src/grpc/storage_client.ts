// Storage gRPC 클라이언트 — storage-service:50051 연동
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

export interface StorageStats {
  hit_rate: number;
  total_bytes: number;
  used_bytes: number;
  domain_stats: { domain: string; size_bytes: number; file_count: number; hit_rate: number }[];
}
export interface PopularEntry { url: string; domain: string; size_bytes: number; hit_count: number; }
export interface PurgeResult { purged_files: number; freed_bytes: number; }

export function createStorageClient(url: string) {
  const StorageService = loadClient('storage.proto', 'cdn.storage.StorageService');
  const client = new StorageService(url, grpc.credentials.createInsecure());
  return {
    stats:       () => call<{ hit_rate: number; total_bytes: number; used_bytes: number; domain_stats: StorageStats['domain_stats'] }>(client, 'Stats', {}),
    popular:     (limit: number) => call<{ entries: PopularEntry[] }>(client, 'Popular', { limit }),
    purgeUrl:    (url: string)    => call<PurgeResult>(client, 'Purge', { url }),
    purgeDomain: (domain: string) => call<PurgeResult>(client, 'Purge', { domain }),
    purgeAll:    ()               => call<PurgeResult>(client, 'Purge', { all: true }),
    health:      ()               => call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
