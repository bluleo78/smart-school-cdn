// Storage gRPC 클라이언트 — storage-service:50051 연동
import * as grpc from '@grpc/grpc-js';
import { loadClient, call } from './shared.js';

export interface StorageStats {
  hit_rate: number;
  total_bytes: number;
  used_bytes: number;
  domain_stats: { domain: string; size_bytes: number; file_count: number; hit_rate: number }[];
}
export interface PopularEntry { url: string; domain: string; size_bytes: number; hit_count: number; }
export interface PurgeResult { purged_files: number; freed_bytes: number; }

/** 저장소 캐시 항목 헤더 */
export interface CachedHeader { name: string; value: string }
/** 저장소 캐시 항목 메타데이터 — GetMetadata RPC 응답 */
export interface StorageMetadata {
  exists: boolean;
  size_bytes: number;
  stored_at: number;
  expires_at: number;
  content_type: string;
  cached_headers: CachedHeader[];
}

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
    /** 캐시 키로 저장소 메타데이터를 조회한다 — URL 진단에 사용 (#387) */
    getMetadata: (key: string)    => call<StorageMetadata>(client, 'GetMetadata', { key }),
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
