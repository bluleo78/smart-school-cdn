/// 프록시 서버의 공유 상태 — 요청 로그, 업타임, 요청 카운터, 캐시 통계
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::RwLock;

const MAX_REQUEST_LOGS: usize = 100;
const MAX_HIT_RATE_HISTORY: usize = 60;

/// 개별 요청 로그 레코드
#[derive(Debug, Clone, Serialize)]
pub struct RequestLog {
    pub method: String,
    pub host: String,
    pub url: String,
    pub status_code: u16,
    pub response_time_ms: u64,
    pub timestamp: DateTime<Utc>,
    /// X-Cache-Status 값: "HIT", "MISS", "BYPASS"
    pub cache_status: String,
    /// 클라이언트에 실제 전송된 응답 바이트 (Range면 슬라이스, br이면 압축본 크기).
    /// 오류/BYPASS 등 body 없는 경우 0.
    pub size: u64,
}

/// 프록시 상태 정보 (관리 API 응답용)
#[derive(Debug, Serialize)]
pub struct ProxyStatus {
    pub online: bool,
    pub uptime: u64,
    pub request_count: u64,
}

/// 히트율 시점 스냅샷 (최근 1시간, 매분 기록)
#[derive(Debug, Clone, Serialize)]
pub struct HitRateSnapshot {
    pub timestamp: DateTime<Utc>,
    pub hit_rate: f64,
}

/// 프록시 서버의 전역 공유 상태
pub struct AppState {
    started_at: Instant,
    request_count: u64,
    request_logs: VecDeque<RequestLog>,
    /// 캐시 HIT 횟수
    pub hit_count: u64,
    /// 캐시 MISS 횟수
    pub miss_count: u64,
    /// 캐시 BYPASS 횟수 (no-store 등)
    pub bypass_count: u64,
    /// L1 메모리 캐시 HIT 횟수
    pub memory_hit_count: u64,
    /// L2 디스크 캐시 HIT 횟수
    pub disk_hit_count: u64,
    /// 매분 히트율 스냅샷 (최대 60개)
    pub hit_rate_history: VecDeque<HitRateSnapshot>,
}

pub type SharedState = Arc<RwLock<AppState>>;

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    /// 새 상태 생성 — 서버 시작 시 1회 호출
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            request_count: 0,
            request_logs: VecDeque::with_capacity(MAX_REQUEST_LOGS),
            hit_count: 0,
            miss_count: 0,
            bypass_count: 0,
            memory_hit_count: 0,
            disk_hit_count: 0,
            hit_rate_history: VecDeque::with_capacity(MAX_HIT_RATE_HISTORY),
        }
    }

    /// 요청 로그 기록 + 카운터 증가
    pub fn record_request(&mut self, log: RequestLog) {
        self.request_count += 1;
        if self.request_logs.len() >= MAX_REQUEST_LOGS {
            self.request_logs.pop_front();
        }
        self.request_logs.push_back(log);
    }

    /// 캐시 HIT 기록
    pub fn record_cache_hit(&mut self) {
        self.hit_count += 1;
    }

    /// 캐시 MISS 기록
    pub fn record_cache_miss(&mut self) {
        self.miss_count += 1;
    }

    /// 캐시 BYPASS 기록 (no-store / 비GET 등)
    pub fn record_cache_bypass(&mut self) {
        self.bypass_count += 1;
    }

    /// L1 메모리 캐시 HIT 기록 — hit_count도 함께 증가 (하위 호환)
    pub fn record_memory_hit(&mut self) {
        self.memory_hit_count += 1;
        self.hit_count += 1;
    }

    /// L2 디스크 캐시 HIT 기록 — hit_count도 함께 증가 (하위 호환)
    pub fn record_disk_hit(&mut self) {
        self.disk_hit_count += 1;
        self.hit_count += 1;
    }

    /// 현재 히트율을 스냅샷으로 기록 (매분 백그라운드 태스크에서 호출)
    pub fn record_hit_rate_snapshot(&mut self) {
        let total = self.hit_count + self.miss_count;
        let hit_rate = if total > 0 {
            (self.hit_count as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        if self.hit_rate_history.len() >= MAX_HIT_RATE_HISTORY {
            self.hit_rate_history.pop_front();
        }
        self.hit_rate_history.push_back(HitRateSnapshot {
            timestamp: Utc::now(),
            hit_rate,
        });
    }

    /// 현재 프록시 상태 조회 (업타임, 요청 수)
    pub fn get_status(&self) -> ProxyStatus {
        ProxyStatus {
            online: true,
            uptime: self.started_at.elapsed().as_secs(),
            request_count: self.request_count,
        }
    }

    /// 최근 요청 로그를 최신순으로 반환
    pub fn get_request_logs(&self) -> Vec<RequestLog> {
        self.request_logs.iter().rev().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_log(url: &str, status: u16) -> RequestLog {
        RequestLog {
            method: "GET".to_string(),
            host: "test.com".to_string(),
            size: 0,
            url: url.to_string(),
            status_code: status,
            response_time_ms: 100,
            timestamp: Utc::now(),
            cache_status: "MISS".to_string(),
        }
    }

    #[test]
    fn 요청_로그_추가_후_조회하면_최신순으로_반환된다() {
        let mut state = AppState::new();
        state.record_request(make_log("/first", 200));
        state.record_request(make_log("/second", 200));
        state.record_request(make_log("/third", 200));

        let logs = state.get_request_logs();
        assert_eq!(logs[0].url, "/third");
        assert_eq!(logs[1].url, "/second");
        assert_eq!(logs[2].url, "/first");
    }

    #[test]
    fn 최대_건수_초과_시_가장_오래된_항목이_삭제된다() {
        let mut state = AppState::new();
        for i in 0..100 {
            state.record_request(make_log(&format!("/req-{i}"), 200));
        }
        assert_eq!(state.request_logs.len(), 100);
        state.record_request(make_log("/overflow", 200));
        assert_eq!(state.request_logs.len(), 100);
        let oldest = state.request_logs.front().unwrap();
        assert_eq!(oldest.url, "/req-1");
    }

    #[test]
    fn 요청_카운터가_정확히_증가한다() {
        let mut state = AppState::new();
        state.record_request(make_log("/a", 200));
        state.record_request(make_log("/b", 404));
        assert_eq!(state.get_status().request_count, 2);
    }

    #[test]
    fn 캐시_이벤트_기록_후_카운터가_증가한다() {
        let mut state = AppState::new();
        state.record_cache_hit();
        state.record_cache_hit();
        state.record_cache_miss();
        assert_eq!(state.hit_count, 2);
        assert_eq!(state.miss_count, 1);
        assert_eq!(state.bypass_count, 0);
    }

    #[test]
    fn 히트율_스냅샷이_최대_60개를_유지한다() {
        let mut state = AppState::new();
        for _ in 0..65 {
            state.record_hit_rate_snapshot();
        }
        assert_eq!(state.hit_rate_history.len(), 60);
    }

    #[test]
    fn 히트율_스냅샷은_현재_히트율을_기록한다() {
        let mut state = AppState::new();
        for _ in 0..3 { state.record_cache_hit(); }
        state.record_cache_miss();
        state.record_hit_rate_snapshot();
        let snap = state.hit_rate_history.back().unwrap();
        assert!((snap.hit_rate - 75.0).abs() < 0.01);
    }

    #[test]
    fn 메모리_히트_디스크_히트_카운터가_독립적으로_증가한다() {
        let mut state = AppState::new();
        state.record_memory_hit();
        state.record_memory_hit();
        state.record_disk_hit();
        assert_eq!(state.memory_hit_count, 2);
        assert_eq!(state.disk_hit_count, 1);
        // 하위 호환: hit_count = memory + disk
        assert_eq!(state.hit_count, 3);
    }
}
