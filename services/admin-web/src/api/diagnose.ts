/// URL 진단 API 클라이언트 (#387) — 도메인 상세의 진단 탭에서 사용한다.
/// admin-server `/api/domains/:host/diagnose` 가 proxy + storage + optimization_events 를
/// fan-in 한 결과를 그대로 받아 UI 패널에 매핑한다.
import axios from 'axios';

/** 진단 기간 selector — 1h / 24h / 7d 화이트리스트 (다른 도메인 detail 탭과 동일) */
export type DiagnoseRange = '1h' | '24h' | '7d';

/** CDN 패널 — proxy /diagnose 응답을 그대로 전달. 부분 실패 시 null. */
export interface DiagnoseCdn {
  current_state: 'HIT' | 'MISS' | 'BYPASS';
  layer: 'L1' | 'L2' | 'none';
  l1_hit?: boolean;
  l2_hit?: boolean;
  bypass_count_recent?: number;
}

/** Origin 패널 — optimization_events 집계 기반. status 는 sample 0 시 null. */
export interface DiagnoseOrigin {
  status: 'ok' | 'degraded' | 'down' | null;
  avg_rtt_ms: number | null;
  error_5xx: number;
  timeout_count: number;
  sample_count: number;
}

/** 캐시 사본 패널 — storage GetMetadata 결과. 부분 실패 또는 미존재 시 null. */
export interface DiagnoseCacheCopy {
  exists: boolean;
  size_bytes: number;
  stored_at: number;   // unix epoch seconds
  expires_at: number;  // unix epoch seconds (0 = no expiry)
}

/** Range 응답 분포 — optimization_events.range_header 집계 */
export interface DiagnoseRangeDist {
  single_count: number;
  multi_count: number;
  none_count: number;
}

/** 진단 응답 전체 — admin-server fan-in shape */
export interface DomainDiagnoseResponse {
  cdn: DiagnoseCdn | null;
  origin: DiagnoseOrigin;
  cache_copy: DiagnoseCacheCopy | null;
  response_headers: Array<{ name: string; value: string }> | null;
  range: DiagnoseRangeDist;
  hit_ratio_pct: number | null;
  sample_count: number;
}

/** 단일 URL 진단 호출 — path 는 `/` 시작 필수, query 는 raw 쿼리스트링. */
export async function fetchDomainDiagnose(
  host: string,
  params: { path: string; query?: string; range: DiagnoseRange },
): Promise<DomainDiagnoseResponse> {
  const res = await axios.get<DomainDiagnoseResponse>(
    `/api/domains/${encodeURIComponent(host)}/diagnose`,
    { params: { path: params.path, query: params.query ?? '', range: params.range } },
  );
  return res.data;
}
