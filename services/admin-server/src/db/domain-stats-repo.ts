import type { Database } from 'better-sqlite3';

// 시간 단위 상수 (초)
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;
const WEEK_SECONDS = 604800;
const MONTH_SECONDS = 2592000;

/**
 * domain_stats 테이블 단일 행 타입
 * - host: 도메인 호스트
 * - timestamp: 버킷 시작 Unix 타임스탬프 (초)
 * - requests: 요청 수
 * - cache_hits: 캐시 히트 수 (하위 호환 — l1_hits + l2_hits)
 * - cache_misses: 캐시 미스 수
 * - bandwidth: 전송 바이트 합
 * - avg_response_time: 평균 응답 시간 (ms)
 * - l1_hits: L1(메모리) 캐시 히트 수 (Phase 12 신규)
 * - l2_hits: L2(디스크) 캐시 히트 수 (Phase 12 신규)
 * - bypass_method: 메서드 불일치로 인한 캐시 우회 수 (Phase 12 신규)
 * - bypass_nocache: no-cache 헤더로 인한 캐시 우회 수 (Phase 12 신규)
 * - bypass_size: 크기 초과로 인한 캐시 우회 수 (Phase 12 신규)
 * - bypass_other: 기타 캐시 우회 수 (Phase 12 신규)
 */
export interface DomainStatsRow {
  host: string;
  timestamp: number;
  requests: number;
  cache_hits: number;      // 하위 호환 (= l1_hits + l2_hits)
  cache_misses: number;
  bandwidth: number;
  avg_response_time: number;
  // 신규 6 컬럼 (Phase 12)
  l1_hits: number;
  l2_hits: number;
  bypass_method: number;
  bypass_nocache: number;
  bypass_size: number;
  bypass_other: number;
}

/** getStats 반환 타입 — 요약 + 시계열 */
export interface DomainStatsResult {
  summary: {
    total_requests: number;
    total_cache_hits: number;
    total_cache_misses: number;
    total_bandwidth: number;
    avg_response_time: number;
    hit_rate: number;
    /** 이전 동일 기간 대비 요청 수 변화율(%) */
    requests_delta: number;
    /** 이전 동일 기간 대비 히트율 변화율(%) */
    hit_rate_delta: number;
    /** 이전 동일 기간 대비 응답 시간 변화율(%) */
    response_time_delta: number;
  };
  timeseries: Array<{
    timestamp: number;
    requests: number;
    cache_hits: number;
    cache_misses: number;
    bandwidth: number;
    avg_response_time: number;
    l1_hits: number;
    l2_hits: number;
    bypass_method: number;
    bypass_nocache: number;
    bypass_size: number;
    bypass_other: number;
  }>;
}

/** getSummaryAll 반환 타입 — 목록 페이지 카드용 */
export interface DomainSummary {
  host: string;
  today_requests: number;
  today_cache_hits: number;
  today_bandwidth: number;
  hit_rate: number;
  /** 최근 24시간 시간별 요청 수 배열 (최대 24개) */
  hourly: number[];
  /** 전일 대비 요청 수 변화율(%) */
  today_requests_delta: number;
  /** 전일 대비 히트율 변화율(%) */
  hit_rate_delta: number;
  // Phase 12 신규 (선택 필드 — 마이그레이션 직후 값이 0이어도 UI가 안전하게 소비)
  /** L1(메모리) 캐시 히트율 = today_l1_hits / today_requests */
  today_l1_hit_rate: number;
  /** 엣지(L1+L2) 캐시 히트율 = (today_l1_hits + today_l2_hits) / today_requests */
  today_edge_hit_rate: number;
  /** 캐시 우회율 = today_bypass_total / today_requests */
  today_bypass_rate: number;
}

/** period 허용 값 — 1h 추가, custom은 range 파라미터와 함께 사용 */
export type StatsPeriod = '1h' | '24h' | '7d' | '30d' | 'custom';

/**
 * 도메인 통계 리포지토리
 * 생성자로 DB 커넥션을 주입받아 테스트에서 쉽게 교체할 수 있도록 한다.
 */
export class DomainStatsRepository {
  constructor(private readonly db: Database) {}

  /** 전일 대비 변화율(%) 계산 — 이전 값이 0이면 0 반환 */
  private getDelta(todayValue: number, yesterdayValue: number): number {
    if (yesterdayValue === 0) return 0;
    return Math.round(((todayValue - yesterdayValue) / yesterdayValue) * 1000) / 10;
  }

  /**
   * 통계 행 삽입
   * ON CONFLICT 시 누적 가능한 수치(requests/cache_hits/cache_misses/bandwidth)는
   * 기존 값에 더하고, avg_response_time은 새 값으로 덮어쓴다.
   */
  insert(row: DomainStatsRow): void {
    this.db
      .prepare(
        `INSERT INTO domain_stats (
           host, timestamp, requests, cache_hits, cache_misses,
           bandwidth, avg_response_time,
           l1_hits, l2_hits, bypass_method, bypass_nocache, bypass_size, bypass_other
         ) VALUES (
           @host, @timestamp, @requests, @cache_hits, @cache_misses,
           @bandwidth, @avg_response_time,
           @l1_hits, @l2_hits, @bypass_method, @bypass_nocache, @bypass_size, @bypass_other
         )
         ON CONFLICT(host, timestamp) DO UPDATE SET
           requests          = requests          + excluded.requests,
           cache_hits        = cache_hits        + excluded.cache_hits,
           cache_misses      = cache_misses      + excluded.cache_misses,
           bandwidth         = bandwidth         + excluded.bandwidth,
           avg_response_time = excluded.avg_response_time,
           l1_hits           = l1_hits           + excluded.l1_hits,
           l2_hits           = l2_hits           + excluded.l2_hits,
           bypass_method     = bypass_method     + excluded.bypass_method,
           bypass_nocache    = bypass_nocache    + excluded.bypass_nocache,
           bypass_size       = bypass_size       + excluded.bypass_size,
           bypass_other      = bypass_other      + excluded.bypass_other`,
      )
      .run(row);
  }

  /**
   * 기간별 도메인 통계 조회
   * - '1h' : 60초 버킷으로 집계 (신규)
   * - '24h': 3600초(1시간) 버킷으로 집계
   * - '7d' / '30d': 86400초(1일) 버킷으로 집계
   * - 'custom': range.from~range.to 구간을 스팬에 따라 버킷 자동 선택
   * summary는 기간 전체 합계/평균, timeseries는 버킷별 집계 배열을 반환한다.
   */
  getStats(host: string, period: StatsPeriod, range?: { from: number; to: number }): DomainStatsResult {
    const now = Math.floor(Date.now() / 1000);

    // 기간/버킷/시작·종료 시각 결정
    let since: number;
    let until: number;
    let bucketSize: number;
    if (period === 'custom') {
      // custom은 반드시 유효한 range를 전달해야 한다
      if (!range || range.to <= range.from) {
        throw new Error('custom period requires valid from/to');
      }
      since = range.from;
      until = range.to;
      const span = until - since;
      // 스팬에 따라 버킷 크기 자동 선택: 1시간 이내→60초, 하루 이내→3600초, 그 이상→86400초
      bucketSize = span <= HOUR_SECONDS ? MINUTE_SECONDS : span <= DAY_SECONDS ? HOUR_SECONDS : DAY_SECONDS;
    } else if (period === '1h') {
      // 1시간 기간: 60초 단위 버킷으로 세밀하게 집계
      since = now - HOUR_SECONDS;
      until = now;
      bucketSize = MINUTE_SECONDS;
    } else {
      // 24h / 7d / 30d 기존 로직
      until = now;
      bucketSize = period === '24h' ? HOUR_SECONDS : DAY_SECONDS;
      since = period === '24h' ? now - DAY_SECONDS : period === '7d' ? now - WEEK_SECONDS : now - MONTH_SECONDS;
    }

    // 버킷별 집계: timestamp를 버킷 크기로 내림하여 그룹화
    type TimeseriesRow = {
      bucket: number;
      requests: number;
      cache_hits: number;
      cache_misses: number;
      bandwidth: number;
      avg_response_time: number;
      l1_hits: number;
      l2_hits: number;
      bypass_method: number;
      bypass_nocache: number;
      bypass_size: number;
      bypass_other: number;
    };

    const rows = this.db
      .prepare(
        `SELECT
           (timestamp / ?) * ? AS bucket,
           SUM(requests)         AS requests,
           SUM(cache_hits)       AS cache_hits,
           SUM(cache_misses)     AS cache_misses,
           SUM(bandwidth)        AS bandwidth,
           AVG(avg_response_time) AS avg_response_time,
           SUM(l1_hits)          AS l1_hits,
           SUM(l2_hits)          AS l2_hits,
           SUM(bypass_method)    AS bypass_method,
           SUM(bypass_nocache)   AS bypass_nocache,
           SUM(bypass_size)      AS bypass_size,
           SUM(bypass_other)     AS bypass_other
         FROM domain_stats
         WHERE host = ? AND timestamp >= ? AND timestamp < ?
         GROUP BY bucket
         ORDER BY bucket ASC`,
      )
      .all(bucketSize, bucketSize, host, since, until) as TimeseriesRow[];

    // 전체 요약 계산
    const totalRequests = rows.reduce((s, r) => s + r.requests, 0);
    const totalCacheHits = rows.reduce((s, r) => s + r.cache_hits, 0);
    const totalCacheMisses = rows.reduce((s, r) => s + r.cache_misses, 0);
    const totalBandwidth = rows.reduce((s, r) => s + r.bandwidth, 0);
    const avgResponseTime =
      rows.length > 0
        ? Math.round(rows.reduce((s, r) => s + r.avg_response_time, 0) / rows.length)
        : 0;
    const hitRate = totalRequests > 0 ? totalCacheHits / totalRequests : 0;

    // 이전 동일 기간 쿼리 — duration을 until-since로 일반화하여 custom/1h도 올바르게 동작
    const duration = until - since;
    const prevSince = since - duration;

    const prevRows = this.db
      .prepare(
        `SELECT
           SUM(requests)          AS requests,
           SUM(cache_hits)        AS cache_hits,
           SUM(bandwidth)         AS bandwidth,
           AVG(avg_response_time) AS avg_response_time
         FROM domain_stats
         WHERE host = ? AND timestamp >= ? AND timestamp < ?`,
      )
      .get(host, prevSince, since) as { requests: number; cache_hits: number; bandwidth: number; avg_response_time: number } | undefined;

    const prevRequests = prevRows?.requests ?? 0;
    const prevHitRate = prevRequests > 0 ? (prevRows?.cache_hits ?? 0) / prevRequests : 0;
    const prevResponseTime = prevRows?.avg_response_time ?? 0;

    return {
      summary: {
        total_requests: totalRequests,
        total_cache_hits: totalCacheHits,
        total_cache_misses: totalCacheMisses,
        total_bandwidth: totalBandwidth,
        avg_response_time: avgResponseTime,
        hit_rate: hitRate,
        requests_delta: this.getDelta(totalRequests, prevRequests),
        hit_rate_delta: this.getDelta(hitRate, prevHitRate),
        response_time_delta: this.getDelta(avgResponseTime, prevResponseTime),
      },
      timeseries: rows.map((r) => ({
        timestamp: r.bucket,
        requests: r.requests,
        cache_hits: r.cache_hits,
        cache_misses: r.cache_misses,
        bandwidth: r.bandwidth,
        avg_response_time: Math.round(r.avg_response_time),
        l1_hits: r.l1_hits,
        l2_hits: r.l2_hits,
        bypass_method: r.bypass_method,
        bypass_nocache: r.bypass_nocache,
        bypass_size: r.bypass_size,
        bypass_other: r.bypass_other,
      })),
    };
  }

  /**
   * 전체 도메인 요약 조회 (목록 페이지 카드용)
   * - 오늘(자정 기준) 요청 수, 캐시 히트 수, 대역폭, 히트율 집계
   * - 최근 24시간 시간별 요청 수 배열(hourly) 포함
   */
  getSummaryAll(): DomainSummary[] {
    const now = Math.floor(Date.now() / 1000);
    // 오늘 자정 Unix 타임스탬프
    const todayStart = now - (now % 86400);
    const since24h = now - 86400;

    // 오늘 통계 집계 — L1/L2/bypass 신규 컬럼 포함
    type TodayRow = {
      host: string;
      today_requests: number;
      today_cache_hits: number;
      today_bandwidth: number;
      today_l1_hits: number;
      today_l2_hits: number;
      today_bypass_total: number;
    };

    const todayRows = this.db
      .prepare(
        `SELECT
           host,
           SUM(requests)                                                       AS today_requests,
           SUM(cache_hits)                                                     AS today_cache_hits,
           SUM(bandwidth)                                                      AS today_bandwidth,
           SUM(l1_hits)                                                        AS today_l1_hits,
           SUM(l2_hits)                                                        AS today_l2_hits,
           SUM(bypass_method + bypass_nocache + bypass_size + bypass_other)    AS today_bypass_total
         FROM domain_stats
         WHERE timestamp >= ?
         GROUP BY host`,
      )
      .all(todayStart) as TodayRow[];

    // 어제 통계 집계 — 전일 대비 변화율 계산용 (delta에는 신규 컬럼 불필요)
    type YesterdayRow = {
      host: string;
      today_requests: number;
      today_cache_hits: number;
      today_bandwidth: number;
    };
    const yesterdayStart = todayStart - 86400;
    const yesterdayRows = this.db
      .prepare(
        `SELECT
           host,
           SUM(requests)   AS today_requests,
           SUM(cache_hits) AS today_cache_hits,
           SUM(bandwidth)  AS today_bandwidth
         FROM domain_stats
         WHERE timestamp >= ? AND timestamp < ?
         GROUP BY host`,
      )
      .all(yesterdayStart, todayStart) as YesterdayRow[];

    const yesterdayMap = new Map<string, YesterdayRow>();
    for (const row of yesterdayRows) {
      yesterdayMap.set(row.host, row);
    }

    // 최근 24시간 시간별 집계 (1시간 버킷)
    type HourlyRow = {
      host: string;
      bucket: number;
      requests: number;
    };

    const hourlyRows = this.db
      .prepare(
        `SELECT
           host,
           (timestamp / 3600) * 3600 AS bucket,
           SUM(requests) AS requests
         FROM domain_stats
         WHERE timestamp >= ?
         GROUP BY host, bucket
         ORDER BY host, bucket ASC`,
      )
      .all(since24h) as HourlyRow[];

    // host별 hourly 맵 구성
    const hourlyMap = new Map<string, number[]>();
    for (const row of hourlyRows) {
      if (!hourlyMap.has(row.host)) hourlyMap.set(row.host, []);
      hourlyMap.get(row.host)!.push(row.requests);
    }

    return todayRows.map((r) => {
      const yesterday = yesterdayMap.get(r.host);
      const yesterdayRequests = yesterday?.today_requests ?? 0;
      const yesterdayHitRate = yesterdayRequests > 0 ? (yesterday?.today_cache_hits ?? 0) / yesterdayRequests : 0;
      const todayHitRate = r.today_requests > 0 ? r.today_cache_hits / r.today_requests : 0;
      const todayReq = r.today_requests;
      return {
        host: r.host,
        today_requests: todayReq,
        today_cache_hits: r.today_cache_hits,
        today_bandwidth: r.today_bandwidth,
        hit_rate: todayHitRate,
        hourly: hourlyMap.get(r.host) ?? [],
        today_requests_delta: this.getDelta(todayReq, yesterdayRequests),
        hit_rate_delta: this.getDelta(todayHitRate, yesterdayHitRate),
        // Phase 12 신규 — divide-by-zero 가드 포함
        today_l1_hit_rate:   todayReq > 0 ? r.today_l1_hits      / todayReq : 0,
        today_edge_hit_rate: todayReq > 0 ? (r.today_l1_hits + r.today_l2_hits) / todayReq : 0,
        today_bypass_rate:   todayReq > 0 ? r.today_bypass_total  / todayReq : 0,
      };
    });
  }

  /** 단일 호스트 요약 통계 반환 — /api/domains/:host/summary 라우트용.
   *  getSummaryAll() 결과에서 해당 host만 필터링하여 반환한다. */
  getSummaryForHost(host: string): DomainSummary | undefined {
    return this.getSummaryAll().find((r) => r.host === host);
  }

  /**
   * 30일 이전 데이터 삭제
   * 오래된 통계를 정리하여 DB 크기를 제한한다.
   */
  cleanup(): number {
    const cutoff = Math.floor(Date.now() / 1000) - 2592000; // 30일 = 30 * 86400
    return this.db.prepare(`DELETE FROM domain_stats WHERE timestamp < ?`).run(cutoff).changes;
  }
}
