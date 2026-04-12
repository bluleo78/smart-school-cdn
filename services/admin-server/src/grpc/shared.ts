// services/admin-server/src/grpc/shared.ts
// gRPC 클라이언트 공용 유틸리티
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROTO_BASE: string = process.env.PROTO_BASE_PATH
  ?? path.resolve(__dirname, '../../../../crates/cdn-proto/proto');

export type GrpcConstructor = new (
  addr: string,
  creds: grpc.ChannelCredentials,
) => grpc.Client;

export function loadClient(protoFile: string, servicePath: string): GrpcConstructor {
  const pkg = protoLoader.loadSync(path.join(PROTO_BASE, protoFile), {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const def = grpc.loadPackageDefinition(pkg) as Record<string, unknown>;
  const parts = servicePath.split('.');
  let svc: unknown = def;
  for (const p of parts) svc = (svc as Record<string, unknown>)[p];
  return svc as GrpcConstructor;
}

/// gRPC 단항 호출 — 기본 5초 타임아웃
export function call<T>(
  client: grpc.Client,
  method: string,
  req: object,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = new Date(Date.now() + timeoutMs);
  return new Promise((resolve, reject) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    (client as unknown as Record<string, Function>)[method](
      req,
      { deadline },
      (err: grpc.ServiceError | null, res: T) => (err ? reject(err) : resolve(res)),
    ),
  );
}
