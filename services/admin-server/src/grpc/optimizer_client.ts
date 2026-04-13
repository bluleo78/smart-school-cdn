// Optimizer gRPC 클라이언트 — optimizer-service:50054 연동
import * as grpc from '@grpc/grpc-js';
import { loadClient, call } from './shared.js';

export interface OptimizerProfile {
  domain: string;
  quality: number;
  max_width: number;
  enabled: boolean;
}
export interface DomainStats {
  domain: string;
  original_bytes: number;
  optimized_bytes: number;
  count: number;
}

export function createOptimizerClient(url: string) {
  const OptimizerService = loadClient('optimizer.proto', 'cdn.optimizer.OptimizerService');
  const client = new OptimizerService(url, grpc.credentials.createInsecure());
  return {
    getProfiles: () => call<{ profiles: OptimizerProfile[] }>(client, 'GetProfiles', {}),
    setProfile:  (profile: OptimizerProfile) => call<object>(client, 'SetProfile', { profile }),
    getStats:    () => call<{ stats: DomainStats[] }>(client, 'GetStats', {}),
    health:      () => call<{ online: boolean; latency_ms: number }>(client, 'Health', {}),
  };
}

export type OptimizerClient = ReturnType<typeof createOptimizerClient>;
