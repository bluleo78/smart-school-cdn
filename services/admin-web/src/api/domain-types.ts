/// 도메인 관련 타입 정의

/** 도메인 한 건 */
export interface Domain {
  host: string;
  origin: string;
  enabled: number;
  description: string;
  created_at: number;
  updated_at: number;
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

/** 도메인 알림 (TLS 만료, 싱크 오류) */
export interface DomainAlert {
  type: 'tls_expiring' | 'sync_failed';
  host: string;
  expiresAt?: string;
  lastError?: string;
}

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
