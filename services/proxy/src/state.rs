/// 프록시 서버의 공유 상태 — 요청 로그, 업타임, 요청 카운터
/// Arc<RwLock<AppState>>로 래핑하여 여러 핸들러에서 안전하게 접근
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::RwLock;

/// 최근 요청 로그 최대 보관 건수
const MAX_REQUEST_LOGS: usize = 100;

/// 개별 요청에 대한 로그 레코드
#[derive(Debug, Clone, Serialize)]
pub struct RequestLog {
    pub method: String,
    pub host: String,
    pub url: String,
    pub status_code: u16,
    pub response_time_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// 프록시 상태 정보 (관리 API 응답용)
#[derive(Debug, Serialize)]
pub struct ProxyStatus {
    pub online: bool,
    pub uptime: u64,
    pub request_count: u64,
}

/// 프록시 서버의 전역 공유 상태
pub struct AppState {
    /// 서버 시작 시각 (업타임 계산용)
    started_at: Instant,
    /// 총 요청 처리 수
    request_count: u64,
    /// 최근 요청 로그 (최대 MAX_REQUEST_LOGS건, 오래된 항목 자동 삭제)
    request_logs: VecDeque<RequestLog>,
}

/// 여러 axum 핸들러에서 공유하기 위한 타입 별칭
pub type SharedState = Arc<RwLock<AppState>>;

impl AppState {
    /// 새 상태 생성 — 서버 시작 시 1회 호출
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            request_count: 0,
            request_logs: VecDeque::with_capacity(MAX_REQUEST_LOGS),
        }
    }

    /// 요청 로그를 기록하고 카운터를 증가시킨다
    /// 로그가 MAX_REQUEST_LOGS를 초과하면 가장 오래된 항목을 삭제
    pub fn record_request(&mut self, log: RequestLog) {
        self.request_count += 1;
        // 용량 초과 시 가장 오래된 로그 삭제
        if self.request_logs.len() >= MAX_REQUEST_LOGS {
            self.request_logs.pop_front();
        }
        self.request_logs.push_back(log);
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

    /// 테스트용 더미 로그 생성
    fn make_log(url: &str, status: u16) -> RequestLog {
        RequestLog {
            method: "GET".to_string(),
            host: "test.com".to_string(),
            url: url.to_string(),
            status_code: status,
            response_time_ms: 100,
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn 요청_로그_추가_후_조회하면_최신순으로_반환된다() {
        let mut state = AppState::new();
        state.record_request(make_log("/first", 200));
        state.record_request(make_log("/second", 200));
        state.record_request(make_log("/third", 200));

        let logs = state.get_request_logs();
        // 최신순: third → second → first
        assert_eq!(logs[0].url, "/third");
        assert_eq!(logs[1].url, "/second");
        assert_eq!(logs[2].url, "/first");
    }

    #[test]
    fn 최대_건수_초과_시_가장_오래된_항목이_삭제된다() {
        let mut state = AppState::new();
        // 100건 채우기
        for i in 0..100 {
            state.record_request(make_log(&format!("/req-{i}"), 200));
        }
        assert_eq!(state.request_logs.len(), 100);

        // 101번째 추가 → 첫 번째(/req-0) 삭제
        state.record_request(make_log("/overflow", 200));
        assert_eq!(state.request_logs.len(), 100);

        // 가장 오래된 로그가 /req-1 이어야 함 (/req-0은 삭제됨)
        let oldest = state.request_logs.front().unwrap();
        assert_eq!(oldest.url, "/req-1");
    }

    #[test]
    fn 요청_카운터가_정확히_증가한다() {
        let mut state = AppState::new();
        assert_eq!(state.get_status().request_count, 0);

        state.record_request(make_log("/a", 200));
        state.record_request(make_log("/b", 404));
        assert_eq!(state.get_status().request_count, 2);
    }

    #[test]
    fn 업타임은_0_이상이다() {
        let state = AppState::new();
        let status = state.get_status();
        // 생성 직후이므로 업타임은 0 또는 매우 작은 값
        assert!(status.uptime < 2);
        assert!(status.online);
    }
}
