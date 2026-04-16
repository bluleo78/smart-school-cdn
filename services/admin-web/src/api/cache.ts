/// 캐시 API 클라이언트 — Admin Server의 캐시 엔드포인트를 호출한다.
import axios from 'axios';

/** 도메인별 캐시 통계 */
export interface DomainStats {
  domain: string;
  hit_count: number;
  size_bytes: number;
}

/** 히트율 시점 스냅샷 */
export interface HitRateSnapshot {
  timestamp: string;
  hit_rate: number;
}

/** 캐시 통계 응답 */
export interface CacheStats {
  hit_count: number;
  miss_count: number;
  bypass_count: number;
  hit_rate: number;
  total_size_bytes: number;
  max_size_bytes: number;
  entry_count: number;
  by_domain: DomainStats[];
  hit_rate_history: HitRateSnapshot[];
}

/** 인기 콘텐츠 항목 */
export interface CacheEntry {
  url: string;
  domain: string;
  content_type: string | null;
  size_bytes: number;
  hit_count: number;
  created_at: string;
  accessed_at: string;
  expires_at: string | null;
}

/** 퍼지 요청 */
export interface PurgeRequest {
  type: 'url' | 'domain' | 'all';
  target?: string;
}

/** 퍼지 결과 */
export interface PurgeResult {
  purged_count: number;
  freed_bytes: number;
}

export async function fetchCacheStats(): Promise<CacheStats> {
  const res = await axios.get<CacheStats>('/api/cache/stats');
  return res.data;
}

export async function fetchCachePopular(domain?: string): Promise<CacheEntry[]> {
  const res = await axios.get<CacheEntry[]>('/api/cache/popular', {
    params: domain ? { domain } : undefined,
  });
  return res.data;
}

export async function purgeCache(req: PurgeRequest): Promise<PurgeResult> {
  const res = await axios.delete<PurgeResult>('/api/cache/purge', { data: req });
  return res.data;
}
