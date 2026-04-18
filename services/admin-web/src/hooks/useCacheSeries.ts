import { useQuery } from '@tanstack/react-query';
import {
  fetchCacheSeries,
  type CacheSeriesBucket,
  type CacheSeriesRange,
} from '../api/cache';

/** 캐시 결과 분포 시계열(스택 영역 차트용) — 10초 주기 자동 갱신.
 *  host 파라미터를 주면 해당 도메인만 필터, 생략 시 전체 합산. */
export function useCacheSeries(range: CacheSeriesRange, host?: string) {
  return useQuery<CacheSeriesBucket[]>({
    queryKey: ['cache', 'series', range, host ?? null],
    queryFn: () => fetchCacheSeries(range, host),
    refetchInterval: 10_000,
  });
}
