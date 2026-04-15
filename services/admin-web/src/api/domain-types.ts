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

/** 일괄 추가 결과 */
export interface BulkAddResult {
  success: number;
  failed: Array<{ host: string; error: string }>;
  syncError?: string;
}

/** 도메인 목록 필터 */
export interface DomainsFilter {
  q?: string;
  enabled?: boolean;
  sort?: string;
}
