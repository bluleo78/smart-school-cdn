/// Proxy API 클라이언트
/// Admin Server의 프록시 상태/요청 로그 엔드포인트를 호출한다.
import axios from 'axios';

/** 프록시 상태 응답 타입 */
export interface ProxyStatus {
  online: boolean;
  uptime: number;
  request_count: number;
}

/** 요청 로그 레코드 타입 */
export interface RequestLog {
  method: string;
  host: string;
  url: string;
  status_code: number;
  response_time_ms: number;
  timestamp: string;
}

/** 프록시 상태 조회 */
export async function fetchProxyStatus(): Promise<ProxyStatus> {
  const res = await axios.get<ProxyStatus>('/api/proxy/status');
  return res.data;
}

/** 최근 요청 로그 조회 */
export async function fetchProxyRequests(): Promise<RequestLog[]> {
  const res = await axios.get<RequestLog[]>('/api/proxy/requests');
  return res.data;
}

/** 프록시 테스트 결과 타입 */
export interface ProxyTestResult {
  success: boolean;
  status_code: number;
  response_time_ms: number;
  error?: string;
}

/** 프록시 테스트 — 지정 도메인+경로로 실제 요청을 전송하고 결과를 반환한다 */
export async function testProxy(
  domain: string,
  path: string,
  protocol: 'http' | 'https' = 'http',
): Promise<ProxyTestResult> {
  const res = await axios.post<ProxyTestResult>('/api/proxy/test', { domain, path, protocol });
  return res.data;
}
