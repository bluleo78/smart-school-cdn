/// Proxy 서비스의 라이브러리 진입점
/// - main.rs와 tests/ 통합 테스트가 공유하는 라우터 빌더를 노출한다.
/// - 테스트에서는 임의의 ProxyConfig를 주입해 원본 서버를 mock으로 교체할 수 있다.
pub mod config;
pub mod state;

use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use axum::Router;

use config::ProxyConfig;
use state::{RequestLog, SharedState};

/// 프록시 핸들러에 주입되는 상태 튜플 타입
type ProxyHandlerState = (SharedState, Arc<ProxyConfig>, reqwest::Client);

/// 프록시 라우터 빌드 — 모든 경로를 proxy_handler로 위임한다.
/// 테스트에서는 원하는 ProxyConfig와 공유 상태를 주입할 수 있다.
pub fn build_proxy_router(
    shared_state: SharedState,
    proxy_config: Arc<ProxyConfig>,
    http_client: reqwest::Client,
) -> Router {
    Router::new()
        .fallback(proxy_handler)
        .with_state((shared_state, proxy_config, http_client))
}

/// 관리 API 라우터 빌드 — /status, /requests 엔드포인트 제공
pub fn build_admin_router(shared_state: SharedState) -> Router {
    Router::new()
        .route("/status", get(status_handler))
        .route("/requests", get(requests_handler))
        .with_state(shared_state)
}

// ─── 프록시 핸들러 ──────────────────────────────────────────────

/// 리버스 프록시 핸들러 — Host 헤더 기반으로 원본 서버에 요청 중계
async fn proxy_handler(
    State((state, config, client)): State<ProxyHandlerState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let start = Instant::now();

    // 1. Host 헤더에서 대상 도메인 추출
    let host = match headers.get("host").and_then(|v| v.to_str().ok()) {
        Some(h) => h.to_string(),
        None => {
            return (StatusCode::BAD_REQUEST, "Missing Host header").into_response();
        }
    };

    // 2. 설정에서 원본 서버 주소 조회
    let origin = match config.get_origin(&host) {
        Some(origin) => origin.to_string(),
        None => {
            tracing::warn!(host = %host, "미등록 도메인 요청");
            return (StatusCode::NOT_FOUND, "Domain not configured").into_response();
        }
    };

    // 3. 원본 서버에 동일 요청 전달
    let origin_url = format!("{}{}", origin, uri);
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response();
        }
    };

    let mut req_builder = client.request(method.clone(), &origin_url);

    // 원본 요청에 필요한 헤더 전달 (hop-by-hop 헤더 제외)
    // RFC 7230 §6.1 hop-by-hop 헤더 전부 제외 — 원본 서버에 전달하면 안 되는 헤더들
    for (key, value) in headers.iter() {
        let name = key.as_str();
        if !matches!(
            name,
            "host"
                | "connection"
                | "transfer-encoding"
                | "proxy-connection"
                | "keep-alive"
                | "upgrade"
                | "te"
                | "trailer"
        ) {
            req_builder = req_builder.header(key, value);
        }
    }

    let origin_response = match req_builder.body(body_bytes).send().await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::error!(error = %err, url = %origin_url, "원본 서버 연결 실패");
            // 요청 로그 기록 (실패)
            let log = RequestLog {
                method: method.to_string(),
                host: host.clone(),
                url: uri.to_string(),
                status_code: 502,
                response_time_ms: start.elapsed().as_millis() as u64,
                timestamp: chrono::Utc::now(),
            };
            state.write().await.record_request(log);
            return (StatusCode::BAD_GATEWAY, "Origin server unreachable").into_response();
        }
    };

    // 원본 응답을 클라이언트에 반환할 응답으로 변환
    let status = origin_response.status();
    let response_headers = origin_response.headers().clone();
    // 원본 스트림 중단 시 클라이언트에 502를 반환해 응답 잘림 방지
    let response_body = match origin_response.bytes().await {
        Ok(b) => b,
        Err(err) => {
            tracing::error!(error = %err, "원본 응답 본문 읽기 실패");
            return (StatusCode::BAD_GATEWAY, "Failed to read origin response").into_response();
        }
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;

    // 4. 요청 로그 기록
    let log = RequestLog {
        method: method.to_string(),
        host: host.clone(),
        url: uri.to_string(),
        status_code: status.as_u16(),
        response_time_ms: elapsed_ms,
        timestamp: chrono::Utc::now(),
    };
    state.write().await.record_request(log);

    tracing::info!(
        method = %method,
        host = %host,
        url = %uri,
        status = %status.as_u16(),
        elapsed_ms = %elapsed_ms,
        "프록시 요청 처리 완료"
    );

    // 5. 응답 빌드 — 원본 헤더 + 캐시 상태 헤더 추가
    let mut response = Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        response = response.header(key, value);
    }
    response = response
        .header("X-Cache-Status", HeaderValue::from_static("BYPASS"))
        .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"));

    response.body(Body::from(response_body)).unwrap()
}

// ─── 관리 API 핸들러 ────────────────────────────────────────────

/// 프록시 상태 조회 — Admin Server가 5초 간격으로 폴링
async fn status_handler(State(state): State<SharedState>) -> Json<state::ProxyStatus> {
    let state = state.read().await;
    Json(state.get_status())
}

/// 최근 요청 로그 조회 — 최신순 최대 100건
async fn requests_handler(State(state): State<SharedState>) -> Json<Vec<RequestLog>> {
    let state = state.read().await;
    Json(state.get_request_logs())
}
