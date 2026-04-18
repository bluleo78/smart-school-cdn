/// 캐시 API 클라이언트 — Admin Server의 캐시 엔드포인트를 호출한다.
import axios from 'axios';

/** 4분류 BYPASS 카운터 */
export interface CacheBypass {
  method: number;
  nocache: number;
  size: number;
  other: number;
  total: number;
}

/** 도메인별 집계 row (대시보드 "도메인별" 표 및 상세 페이지에서 재사용) */
export interface CacheByDomain {
  host: string;
  requests: number;
  l1_hits: number;
  l2_hits: number;
  bypass_total: number;
  l1_hit_rate: number;    // 0-1
  edge_hit_rate: number;  // 0-1
}

/** /api/cache/stats 응답 — 재설계 후 shape */
export interface CacheStats {
  requests: number;
  l1_hits: number;
  l2_hits: number;
  miss: number;
  bypass: CacheBypass;
  l1_hit_rate: number;    // 0-1
  edge_hit_rate: number;  // 0-1
  bypass_rate: number;    // 0-1
  disk: {
    used_bytes: number;
    max_bytes: number;
    entry_count: number;
  };
  by_domain: CacheByDomain[];
}

/** /api/cache/series 한 버킷 */
export interface CacheSeriesBucket {
  ts: number;        // epoch ms
  l1_hits: number;
  l2_hits: number;
  miss: number;
  bypass: number;
}

/** 시계열 범위 */
export type CacheSeriesRange = '1h' | '24h';

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

/** 캐시 전체 통계 조회 */
export async function fetchCacheStats(): Promise<CacheStats> {
  const res = await axios.get<CacheStats>('/api/cache/stats');
  return res.data;
}

/** 스택 영역 차트용 시계열 버킷 */
export async function fetchCacheSeries(
  range: CacheSeriesRange,
  host?: string,
): Promise<CacheSeriesBucket[]> {
  const res = await axios.get<{ buckets: CacheSeriesBucket[] }>(
    '/api/cache/series',
    { params: { range, ...(host ? { host } : {}) } },
  );
  return res.data.buckets;
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
