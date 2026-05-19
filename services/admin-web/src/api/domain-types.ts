/// 도메인 관련 타입 정의

/** 도메인 한 건 */
export interface Domain {
  host: string;
  origin: string;
  enabled: number;
  description: string;
  created_at: number;
  updated_at: number;
  /**
   * 이슈 #429 — 도메인별 stale-if-error 윈도우(초).
   * null/undefined=글로벌 폴백 / 0=비활성 / >0=명시 윈도우. (E2E mock 응답이 필드 누락 가능해 optional 처리)
   */
  stale_if_error_secs?: number | null;
  /**
   * 이슈 #426 — 도메인별 coalescer broadcast 채널 capacity.
   * null/undefined=글로벌 폴백 / >=1=명시값.
   */
  coalesce_capacity?: number | null;
}

/** 도메인 요약 통계 */
export interface DomainSummary {
  total: number;
  enabled: number;
  disabled: number;
  todayRequests: number;
  todayRequestsDelta: number;
  cacheHitRate: number;
  cacheHitRateDelta: number;
  todayBandwidth: number;
  hourlyRequests: number[];
  hourlyCacheHitRate: number[];
  hourlyBandwidth: number[];
  alerts: DomainAlert[];
}

/**
 * 도메인 배너 알림 — discriminated union
 *  - tls_expiring / sync_failed : 특정 host 단위 (도메인 상세로 링크)
 *  - disk_high (#432)            : 시스템 단위 — host 없음. usage_ratio 는 0~100 백분율(서버에서 0.1% 단위 반올림)
 */
export type DomainAlert =
  | { type: 'tls_expiring';  host: string; expiresAt?: string }
  | { type: 'sync_failed';   host: string; lastError?: string }
  | { type: 'stale_serving';    host: string } // #430 — 최근 10분 내 stale 사본 서빙 이력 존재
  | { type: 'coalescer_lagged'; count: number } // #427 — 최근 1분 내 coalescer broadcast lag 발생 건수
  | { type: 'disk_high';        usage_ratio: number; used_bytes: number; total_bytes: number };

/** 단일 도메인 요약 통계 — L1/Edge/Bypass 비율 포함 (Overview 카드용) */
export interface DomainHostSummary {
  host: string;
  today_requests: number;
  today_cache_hits: number;
  today_bandwidth: number;
  hit_rate: number;
  today_l1_hit_rate: number;
  today_edge_hit_rate: number;
  today_bypass_rate: number;
}

/** 도메인 통계 (기간별) */
export interface DomainStats {
  host: string;
  period: '24h' | '7d' | '30d';
  summary: {
    totalRequests: number;
    requestsDelta: number;
    cacheHitRate: number;
    cacheHitRateDelta: number;
    bandwidth: number;
    avgResponseTime: number;
    responseTimeDelta: number;
  };
  timeseries: {
    labels: string[];
    hits: number[];
    misses: number[];
    bandwidth: number[];
    responseTime: number[];
  };
}

/** 도메인 요청 로그 한 건 */
export interface DomainLog {
  timestamp: number;
  status_code: number;
  cache_status: 'HIT' | 'MISS';
  path: string;
  size: number;
}

/** 도메인 Top URL 한 건 */
export interface DomainTopUrl {
  path: string;
  count: number;
}

/**
 * 일괄 추가 결과 (#197)
 * - added: 신규로 추가된 도메인 수
 * - skipped: 이미 존재해 origin 을 보존한 host 목록 (existingOrigin 포함)
 * - failed: SQL 실패한 host 목록 (드물지만 UNIQUE 외 제약/디스크 오류 시 발생 가능)
 *
 * 과거 시맨틱(`success`)은 신규/덮어쓰기를 구분하지 못해 의도치 않은 origin 변경을 감추는 문제가 있어
 * added/skipped/failed 로 분리했다. 서버는 더 이상 기존 host 의 origin 을 덮어쓰지 않는다.
 */
export interface BulkAddResult {
  added: number;
  skipped: Array<{ host: string; existingOrigin: string }>;
  failed: Array<{ host: string; error: string }>;
  syncError?: string;
}

/** 도메인 목록 필터 */
export interface DomainsFilter {
  q?: string;
  enabled?: boolean;
  /** 정렬 기준 컬럼 — API SORT_WHITELIST: host | created_at | updated_at */
  sort?: string;
  /** 정렬 방향 — 'asc' | 'desc' */
  order?: 'asc' | 'desc';
}
