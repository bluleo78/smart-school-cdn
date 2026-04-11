/// Proxy 서비스의 라이브러리 진입점
pub mod cache;
pub mod tls;
pub mod config;
pub mod state;

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{delete, get};
use axum::Router;
use cache::{CacheDirective, CacheLayer, compute_cache_key, parse_cache_control};
use config::ProxyConfig;
use state::{RequestLog, SharedState};

/// 프록시 핸들러 상태 — (공유상태, 설정, HTTP클라이언트, 캐시)
type ProxyHandlerState = (SharedState, Arc<ProxyConfig>, reqwest::Client, Arc<CacheLayer>);

/// 관리 API 핸들러 상태 — (공유상태, 캐시)
#[derive(Clone)]
struct AdminState {
    state: SharedState,
    cache: Arc<CacheLayer>,
}

/// 기본 캐시 TTL (Cache-Control 헤더 없을 때)
const DEFAULT_TTL: Duration = Duration::from_secs(3600);

/// 프록시 라우터 빌드
pub fn build_proxy_router(
    shared_state: SharedState,
    proxy_config: Arc<ProxyConfig>,
    http_client: reqwest::Client,
    cache: Arc<CacheLayer>,
) -> Router {
    Router::new()
        .fallback(proxy_handler)
        .with_state((shared_state, proxy_config, http_client, cache))
}

/// 관리 API 라우터 빌드
pub fn build_admin_router(shared_state: SharedState, cache: Arc<CacheLayer>) -> Router {
    let admin_state = AdminState { state: shared_state, cache };
    Router::new()
        .route("/status", get(status_handler))
        .route("/requests", get(requests_handler))
        .route("/cache/stats", get(cache_stats_handler))
        .route("/cache/popular", get(cache_popular_handler))
        .route("/cache/purge", delete(cache_purge_handler))
        .with_state(admin_state)
}

// ─── 프록시 핸들러 ──────────────────────────────────────────────

async fn proxy_handler(
    State((state, config, client, cache)): State<ProxyHandlerState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let start = Instant::now();

    let host = match headers.get("host").and_then(|v| v.to_str().ok()) {
        Some(h) => h.to_string(),
        None => return (StatusCode::BAD_REQUEST, "Missing Host header").into_response(),
    };

    let origin = match config.get_origin(&host) {
        Some(o) => o.to_string(),
        None => {
            tracing::warn!(host = %host, "미등록 도메인 요청");
            return (StatusCode::NOT_FOUND, "Domain not configured").into_response();
        }
    };

    // GET 요청만 캐시 대상 — POST/PUT 등은 항상 BYPASS
    let cache_key = if method == Method::GET {
        Some(compute_cache_key(
            method.as_str(),
            &host,
            uri.path(),
            uri.query().unwrap_or(""),
        ))
    } else {
        None
    };

    // ── 캐시 HIT 확인 ────────────────────────────────────────
    if let Some(ref key) = cache_key {
        if let Some((cached_bytes, content_type)) = cache.get(key).await {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            {
                let mut app_state = state.write().await;
                app_state.record_cache_hit();
                app_state.record_request(RequestLog {
                    method: method.to_string(),
                    host: host.clone(),
                    url: uri.to_string(),
                    status_code: 200,
                    response_time_ms: elapsed_ms,
                    timestamp: chrono::Utc::now(),
                    cache_status: "HIT".to_string(),
                });
            }
            tracing::info!(host=%host, url=%uri, elapsed_ms=%elapsed_ms, "캐시 HIT");

            let mut resp = Response::builder().status(StatusCode::OK);
            if let Some(ct) = content_type {
                resp = resp.header("Content-Type", ct);
            }
            return resp
                .header("X-Cache-Status", HeaderValue::from_static("HIT"))
                .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
                .body(Body::from(cached_bytes))
                .unwrap();
        }
    }

    // ── 원본 서버에 요청 전달 ─────────────────────────────────
    let origin_url = format!("{}{}", origin, uri);
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response(),
    };

    let mut req_builder = client.request(method.clone(), &origin_url);
    for (key, value) in headers.iter() {
        let name = key.as_str();
        if !matches!(
            name,
            "host" | "connection" | "transfer-encoding" | "proxy-connection"
                | "keep-alive" | "upgrade" | "te" | "trailer"
        ) {
            req_builder = req_builder.header(key, value);
        }
    }

    let origin_response = match req_builder.body(body_bytes).send().await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::error!(error = %err, url = %origin_url, "원본 서버 연결 실패");
            let elapsed_ms = start.elapsed().as_millis() as u64;
            {
                let mut app_state = state.write().await;
                app_state.record_cache_bypass();
                app_state.record_request(RequestLog {
                    method: method.to_string(),
                    host,
                    url: uri.to_string(),
                    status_code: 502,
                    response_time_ms: elapsed_ms,
                    timestamp: chrono::Utc::now(),
                    cache_status: "BYPASS".to_string(),
                });
            }
            return (StatusCode::BAD_GATEWAY, "Origin server unreachable").into_response();
        }
    };

    let status = origin_response.status();
    let response_headers = origin_response.headers().clone();

    // Cache-Control + Pragma 파싱 → 캐시 가능 여부 결정
    let cache_directive = {
        let cc = response_headers
            .get("cache-control")
            .and_then(|v| v.to_str().ok());
        let pragma = response_headers
            .get("pragma")
            .and_then(|v| v.to_str().ok());
        parse_cache_control(cc, pragma)
    };

    let response_body = match origin_response.bytes().await {
        Ok(b) => b,
        Err(err) => {
            tracing::error!(error = %err, "원본 응답 본문 읽기 실패");
            return (StatusCode::BAD_GATEWAY, "Failed to read origin response").into_response();
        }
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;

    // ── 캐시 저장 또는 BYPASS ─────────────────────────────────
    let cache_status_str = if let Some(ref key) = cache_key {
        match &cache_directive {
            CacheDirective::Cacheable(maybe_ttl) if status.is_success() => {
                let ttl = maybe_ttl.unwrap_or(DEFAULT_TTL);
                let content_type = response_headers
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let full_url = format!("https://{}{}", host, uri);
                cache
                    .put(key, &full_url, &host, content_type, response_body.clone(), Some(ttl))
                    .await;
                "MISS"
            }
            _ => "BYPASS",
        }
    } else {
        "BYPASS"
    };

    // 캐시 이벤트 + 요청 로그 기록
    {
        let mut app_state = state.write().await;
        match cache_status_str {
            "MISS" => app_state.record_cache_miss(),
            _ => app_state.record_cache_bypass(),
        }
        app_state.record_request(RequestLog {
            method: method.to_string(),
            host: host.clone(),
            url: uri.to_string(),
            status_code: status.as_u16(),
            response_time_ms: elapsed_ms,
            timestamp: chrono::Utc::now(),
            cache_status: cache_status_str.to_string(),
        });
    }

    tracing::info!(
        method = %method, host = %host, url = %uri,
        status = %status.as_u16(), elapsed_ms = %elapsed_ms,
        cache = %cache_status_str, "프록시 요청 처리 완료"
    );

    // ── 응답 빌드 ─────────────────────────────────────────────
    let mut response = Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        response = response.header(key, value);
    }
    response
        .header("X-Cache-Status", cache_status_str)
        .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
        .body(Body::from(response_body))
        .unwrap()
}

// ─── 관리 API 핸들러 ────────────────────────────────────────────

async fn status_handler(State(admin): State<AdminState>) -> Json<state::ProxyStatus> {
    Json(admin.state.read().await.get_status())
}

async fn requests_handler(State(admin): State<AdminState>) -> Json<Vec<RequestLog>> {
    Json(admin.state.read().await.get_request_logs())
}

async fn cache_stats_handler(State(admin): State<AdminState>) -> impl IntoResponse {
    let state = admin.state.read().await;
    let hit_count = state.hit_count;
    let miss_count = state.miss_count;
    let bypass_count = state.bypass_count;
    let total = hit_count + miss_count;
    let hit_rate = if total > 0 {
        (hit_count as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let hit_rate_history: Vec<_> = state.hit_rate_history.iter().cloned().collect();
    drop(state);

    let domain_stats = admin.cache.get_domain_stats().await;
    let total_size_bytes = admin.cache.current_size_bytes();
    let max_size_bytes = admin.cache.max_size_bytes;
    let entry_count = admin.cache.entry_count().await;

    Json(serde_json::json!({
        "hit_count": hit_count,
        "miss_count": miss_count,
        "bypass_count": bypass_count,
        "hit_rate": hit_rate,
        "total_size_bytes": total_size_bytes,
        "max_size_bytes": max_size_bytes,
        "entry_count": entry_count,
        "by_domain": domain_stats,
        "hit_rate_history": hit_rate_history,
    }))
}

async fn cache_popular_handler(State(admin): State<AdminState>) -> impl IntoResponse {
    let popular = admin.cache.get_popular(20).await;
    Json(popular)
}

/// 퍼지 요청 바디
#[derive(serde::Deserialize)]
struct PurgeRequest {
    /// "url" | "domain" | "all"
    r#type: String,
    /// url 또는 domain 퍼지 시 대상 (all은 불필요)
    target: Option<String>,
}

async fn cache_purge_handler(
    State(admin): State<AdminState>,
    Json(req): Json<PurgeRequest>,
) -> Response {
    let (purged_count, freed_bytes) = match req.r#type.as_str() {
        "url" => {
            // URL로 인덱스를 스캔해 일치하는 항목 삭제
            let Some(url) = req.target.filter(|t| !t.is_empty()) else {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "target required"}))).into_response();
            };
            admin.cache.purge_by_url(&url).await
        }
        "domain" => {
            let Some(domain) = req.target.filter(|t| !t.is_empty()) else {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "target required"}))).into_response();
            };
            admin.cache.purge_domain(&domain).await
        }
        "all" => admin.cache.purge_all().await,
        _ => (0, 0),
    };

    Json(serde_json::json!({
        "purged_count": purged_count,
        "freed_bytes": freed_bytes,
    })).into_response()
}
