/** 시스템 상태 API — 마이크로서비스 헬스체크 엔드포인트 래퍼 */
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';

/** 개별 서비스 상태 */
export interface ServiceStatus {
  online: boolean;
  latency_ms: number;
}

/** 전체 시스템 상태 (proxy / storage / tls / dns) */
export interface SystemStatus {
  proxy: ServiceStatus;
  storage: ServiceStatus;
  tls: ServiceStatus;
  dns: ServiceStatus;
}

/** GET /api/system/status 호출 */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await axios.get<SystemStatus>('/api/system/status');
  return res.data;
}

/** 시스템 상태 폴링 훅 — 10초마다 자동 갱신 */
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 10_000,
  });
}
