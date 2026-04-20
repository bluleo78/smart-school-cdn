/// Phase 16-3: 도메인별 URL 최적화 내역(url-breakdown) 조회 훅.
/// optimization_events 를 URL 단위로 집계한 결과를 검색/정렬/필터/페이지네이션 파라미터로 요청한다.
import { useQuery } from '@tanstack/react-query';

export interface UrlBreakdownItem {
  url: string;
  events: number;
  total_orig: number;
  total_out: number;
  savings_ratio: number;
  decisions: string;
}

export interface UrlBreakdownResponse {
  total: number;
  items: UrlBreakdownItem[];
}

export interface UrlBreakdownQuery {
  host: string;
  period?: '1h' | '24h' | '7d' | '30d';
  sort?: 'savings' | 'orig_size' | 'events';
  decision?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function useDomainUrlOptimization(params: UrlBreakdownQuery) {
  const qs = new URLSearchParams();
  if (params.period) qs.set('period', params.period);
  if (params.sort) qs.set('sort', params.sort);
  if (params.decision) qs.set('decision', params.decision);
  if (params.q) qs.set('q', params.q);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  return useQuery<UrlBreakdownResponse>({
    queryKey: ['domain', params.host, 'url-optimization', params],
    queryFn: async () => {
      const res = await fetch(
        `/api/domains/${encodeURIComponent(params.host)}/optimization/url-breakdown?${qs.toString()}`,
      );
      if (!res.ok) throw new Error('url-breakdown 조회 실패');
      return res.json();
    },
  });
}
