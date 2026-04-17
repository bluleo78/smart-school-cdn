/// DNS 관리 대시보드용 TanStack Query 훅 — /api/dns/* 4종 폴링
import { useQuery } from '@tanstack/react-query';
import {
  fetchDnsStatus,
  fetchDnsRecords,
  fetchDnsQueries,
  fetchDnsMetrics,
  type DnsMetricRange,
} from '../api/dns';

/** DNS 상태 + 누적 통계 — 5초 폴링 */
export function useDnsStatus() {
  return useQuery({
    queryKey: ['dns', 'status'],
    queryFn: fetchDnsStatus,
    refetchInterval: 5_000,
  });
}

/** 등록 레코드 목록 — 30초 폴링 (변경 빈도 낮음) */
export function useDnsRecords() {
  return useQuery({
    queryKey: ['dns', 'records'],
    queryFn: fetchDnsRecords,
    refetchInterval: 30_000,
  });
}

/** 최근 쿼리 로그 — 5초 폴링 */
export function useDnsQueries(limit = 100) {
  return useQuery({
    queryKey: ['dns', 'queries', limit],
    queryFn: () => fetchDnsQueries(limit),
    refetchInterval: 5_000,
  });
}

/** 시계열 메트릭 — 10초 폴링 */
export function useDnsMetrics(range: DnsMetricRange) {
  return useQuery({
    queryKey: ['dns', 'metrics', range],
    queryFn: () => fetchDnsMetrics(range),
    refetchInterval: 10_000,
  });
}
