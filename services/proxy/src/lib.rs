/// Proxy 서비스의 라이브러리 진입점
pub mod clients;
pub mod config;
pub mod state;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

use sha2::{Digest, Sha256};
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{delete, get};
use axum::Router;
use state::{RequestLog, SharedState};
use clients::storage_client::StorageClient;
use clients::tls_client::{TlsClient, CertCache};

/// 런타임에 교체 가능한 도메인→원본서버 맵
pub type DomainMap = Arc<RwLock<HashMap<String, String>>>;

/// 프록시 핸들러 공유 상태
#[derive(Clone)]
pub struct ProxyState {
    pub shared:      SharedState,
    pub http_client: reqwest::Client,
    pub storage:     Arc<Mutex<StorageClient>>,
    pub tls_client:  Arc<Mutex<TlsClient>>,
    pub domain_map:  DomainMap,
    pub cert_cache:  CertCache,
}

/// 관리 API 핸들러 상태
#[derive(Clone)]
#[allow(dead_code)]
struct AdminState {
    state:      SharedState,
    storage:    Arc<Mutex<StorageClient>>,
    tls_client: Arc<Mutex<TlsClient>>,
    domain_map: DomainMap,
    cert_cache: CertCache,
}

/// 기본 캐시 TTL (Cache-Control 헤더 없을 때)
const DEFAULT_TTL: Duration = Duration::from_secs(3600);

/// 프록시 라우터 빌드
pub fn build_proxy_router(ps: ProxyState) -> Router {
    Router::new()
        .route("/ca.crt", get(ca_cert_handler))
        .route("/ca.mobileconfig", get(ca_mobileconfig_handler))
        .fallback(proxy_handler)
        .with_state(ps)
}

/// 관리 API 라우터 빌드
pub fn build_admin_router(
    shared_state: SharedState,
    storage:      Arc<Mutex<StorageClient>>,
    tls_client:   Arc<Mutex<TlsClient>>,
    domain_map:   DomainMap,
    cert_cache:   CertCache,
) -> Router {
    let admin_state = AdminState { state: shared_state, storage, tls_client, domain_map, cert_cache };
    Router::new()
        .route("/status", get(status_handler))
        .route("/requests", get(requests_handler))
        .route("/cache/stats", get(cache_stats_handler))
        .route("/cache/popular", get(cache_popular_handler))
        .route("/cache/purge", delete(cache_purge_handler))
        .route("/tls/ca", get(tls_ca_handler))
        .route("/tls/certificates", get(tls_certificates_handler))
        .route("/domains", axum::routing::post(update_domains_handler))
        .with_state(admin_state)
}

// ─── 캐시 키·파싱 유틸 (기존 cache.rs에서 이전) ───────────────────

/// HTTP 요청에서 캐시 키 계산 — SHA-256 hex string 반환
fn compute_cache_key(method: &str, host: &str, path: &str, query: &str) -> String {
    let input = format!("{method}:{host}{path}?{query}");
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(hash)
}

/// Cache-Control 헤더 해석 결과
#[derive(Debug, PartialEq)]
enum CacheDirective {
    /// 캐시 불가 (no-store / no-cache / private / Pragma:no-cache)
    NoStore,
    /// 캐시 가능 — TTL이 None이면 만료 없음
    Cacheable(Option<Duration>),
}

/// Cache-Control 및 Pragma 헤더를 파싱해 캐싱 지시자 반환
fn parse_cache_control(cache_control: Option<&str>, pragma: Option<&str>) -> CacheDirective {
    if cache_control.is_none() {
        if let Some(p) = pragma {
            if p.contains("no-cache") {
                return CacheDirective::NoStore;
            }
        }
        return CacheDirective::Cacheable(None);
    }
    let cc = cache_control.unwrap();
    for directive in cc.split(',').map(str::trim) {
        let lower = directive.to_lowercase();
        if lower == "no-store" || lower == "no-cache" || lower == "private" {
            return CacheDirective::NoStore;
        }
    }
    let s_maxage = parse_duration_directive(cc, "s-maxage");
    if s_maxage.is_some() {
        return CacheDirective::Cacheable(s_maxage);
    }
    let max_age = parse_duration_directive(cc, "max-age");
    if max_age.is_some() {
        return CacheDirective::Cacheable(max_age);
    }
    CacheDirective::Cacheable(None)
}

/// "directive=N" 형태에서 Duration 추출
fn parse_duration_directive(cc: &str, directive: &str) -> Option<Duration> {
    for part in cc.split(',').map(str::trim) {
        let (name, value) = match part.find('=') {
            Some(pos) => (part[..pos].trim(), Some(part[pos + 1..].trim())),
            None => (part.trim(), None),
        };
        if name.to_lowercase() == directive {
            if let Some(v) = value {
                if let Ok(secs) = v.parse::<u64>() {
                    return Some(Duration::from_secs(secs));
                }
            }
        }
    }
    None
}

// ─── 프록시 핸들러 ──────────────────────────────────────────────

async fn proxy_handler(
    State(ps): State<ProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let start = Instant::now();
    let state = ps.shared;
    let client = ps.http_client;

    let host = match headers.get("host").and_then(|v| v.to_str().ok()) {
        Some(h) => h.to_string(),
        None => return (StatusCode::BAD_REQUEST, "Missing Host header").into_response(),
    };

    // domain_map에서 호스트:포트 → 호스트 추출 후 원본 서버 URL 조회
    let origin = {
        let map = ps.domain_map.read().await;
        let domain = host.split(':').next().unwrap_or(&host);
        map.get(domain).cloned().or_else(|| {
            domain.find('.').and_then(|pos| {
                let wildcard = format!("*.{}", &domain[pos + 1..]);
                map.get(&wildcard).cloned()
            })
        })
    };
    let origin = match origin {
        Some(o) => o,
        None => {
            tracing::warn!(host = %host, "미등록 도메인 요청");
            return (StatusCode::NOT_FOUND, "Domain not configured").into_response();
        }
    };

    // GET 요청만 캐시 대상
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

    // ── 캐시 HIT 확인 (storage gRPC) ─────────────────────────────
    if let Some(ref key) = cache_key {
        if let Some((cached_bytes, content_type)) = ps.storage.lock().await.get(key).await {
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

    // ── 원본 서버에 요청 전달 ─────────────────────────────────────
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let origin_url = format!("{}{}", origin, path_and_query);
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

    // ── 캐시 저장 또는 BYPASS (storage gRPC) ─────────────────────
    let cache_status_str = if let Some(ref key) = cache_key {
        match &cache_directive {
            CacheDirective::Cacheable(maybe_ttl) if status.is_success() => {
                let ttl = maybe_ttl.unwrap_or(DEFAULT_TTL);
                let content_type = response_headers
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let full_url = format!("https://{}{}", host, uri);
                ps.storage.lock().await
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

    // ── 응답 빌드 ─────────────────────────────────────────────────
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

// ─── CA 다운로드 핸들러 ─────────────────────────────────────────────

/// CA 인증서 다운로드 — iPad/PC 설치용 (.crt)
async fn ca_cert_handler(State(ps): State<ProxyState>) -> Response {
    let pem = ps.tls_client.lock().await.get_ca_cert_pem().await;
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/x-pem-file")
        .header(
            "Content-Disposition",
            "attachment; filename=\"smart-school-cdn-ca.crt\"",
        )
        .body(Body::from(pem))
        .unwrap()
}

/// PEM 문자열을 SHA-256 해시하여 UUID v5 형식으로 변환
fn pem_to_uuid(input: &str) -> String {
    let hash = Sha256::digest(input.as_bytes());
    let h = format!("{:x}", hash);
    format!(
        "{}-{}-5{}-8{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..15],
        &h[15..18],
        &h[18..30]
    )
}

/// iOS 구성 프로파일 다운로드 (.mobileconfig)
async fn ca_mobileconfig_handler(State(ps): State<ProxyState>) -> Response {
    let pem = ps.tls_client.lock().await.get_ca_cert_pem().await;
    let b64: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");

    let inner_uuid = pem_to_uuid(&pem);
    let outer_uuid = pem_to_uuid(&format!("{}outer", pem));

    let profile = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>ca.crt</string>
            <key>PayloadContent</key>
            <data>{b64}</data>
            <key>PayloadDescription</key>
            <string>Smart School CDN 루트 인증 기관</string>
            <key>PayloadDisplayName</key>
            <string>Smart School CDN CA</string>
            <key>PayloadIdentifier</key>
            <string>com.smartschool.cdn.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>{inner_uuid}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Smart School CDN</string>
    <key>PayloadIdentifier</key>
    <string>com.smartschool.cdn</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{outer_uuid}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>"#
    );

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/x-apple-aspen-config")
        .header(
            "Content-Disposition",
            "attachment; filename=\"smart-school-cdn.mobileconfig\"",
        )
        .body(Body::from(profile))
        .unwrap()
}

// ─── 관리 API 핸들러 ────────────────────────────────────────────────

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

    let stats = admin.storage.lock().await.stats().await;

    // storage gRPC 통계에서 도메인 통계·크기 추출
    let (total_size_bytes, max_size_bytes, entry_count, domain_stats) = match stats {
        Some(s) => {
            let domains: Vec<serde_json::Value> = s.domain_stats.iter().map(|d| {
                serde_json::json!({
                    "domain": d.domain,
                    "hit_count": d.file_count,
                    "size_bytes": d.size_bytes,
                })
            }).collect();
            (s.used_bytes, s.total_bytes, s.domain_stats.iter().map(|d| d.file_count).sum::<u64>(), domains)
        }
        None => (0, 0, 0, vec![]),
    };

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
    let popular = admin.storage.lock().await.popular(20).await;
    match popular {
        Some(p) => {
            let entries: Vec<serde_json::Value> = p.entries.iter().map(|e| {
                serde_json::json!({
                    "url": e.url,
                    "domain": e.domain,
                    "size_bytes": e.size_bytes,
                    "hit_count": e.hit_count,
                })
            }).collect();
            Json(entries)
        }
        None => Json(vec![]),
    }
}

/// 퍼지 요청 바디
#[derive(serde::Deserialize)]
struct PurgeBody {
    /// "url" | "domain" | "all"
    r#type: String,
    /// url 또는 domain 퍼지 시 대상 (all은 불필요)
    target: Option<String>,
}

async fn cache_purge_handler(
    State(admin): State<AdminState>,
    Json(req): Json<PurgeBody>,
) -> Response {
    let mut storage = admin.storage.lock().await;
    let (purged_count, freed_bytes) = match req.r#type.as_str() {
        "url" => {
            let Some(url) = req.target.filter(|t| !t.is_empty()) else {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "target required"}))).into_response();
            };
            storage.purge_url(&url).await
        }
        "domain" => {
            let Some(domain) = req.target.filter(|t| !t.is_empty()) else {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "target required"}))).into_response();
            };
            storage.purge_domain(&domain).await
        }
        "all" => storage.purge_all().await,
        _ => (0, 0),
    };

    Json(serde_json::json!({
        "purged_count": purged_count,
        "freed_bytes": freed_bytes,
    })).into_response()
}

/// CA 인증서 PEM 반환 — Admin Server 중계용
async fn tls_ca_handler(State(admin): State<AdminState>) -> Response {
    let pem = admin.tls_client.lock().await.get_ca_cert_pem().await;
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/x-pem-file")
        .body(Body::from(pem))
        .unwrap()
}

/// 발급된 도메인 인증서 목록 반환
async fn tls_certificates_handler(State(admin): State<AdminState>) -> impl IntoResponse {
    let certs = admin.tls_client.lock().await.list_certificates().await;
    let list: Vec<serde_json::Value> = certs.iter().map(|c| {
        serde_json::json!({
            "domain": c.domain,
            "issued_at": c.issued_at,
            "expires_at": c.expires_at,
        })
    }).collect();
    Json(list)
}

/// POST /domains 요청 바디 — 단일 도메인 항목
#[derive(serde::Deserialize)]
struct DomainEntry {
    host: String,
    origin: String,
}

/// POST /domains 요청 바디 — 전체 도메인 목록
#[derive(serde::Deserialize)]
struct DomainsPayload {
    domains: Vec<DomainEntry>,
}

/// Admin Server에서 도메인 목록을 push할 때 호출 — 전체 맵 교체 + 인증서 사전 발급
async fn update_domains_handler(
    State(admin): State<AdminState>,
    Json(payload): Json<DomainsPayload>,
) -> StatusCode {
    // 도메인 맵 업데이트
    {
        let mut map = admin.domain_map.write().await;
        map.clear();
        for entry in &payload.domains {
            map.insert(entry.host.clone(), entry.origin.clone());
        }
        tracing::info!(count = map.len(), "도메인 맵 갱신");
    }
    // 각 도메인 인증서 사전 발급 (SNI 핸들러 로컬 캐시 갱신)
    let mut tls = admin.tls_client.lock().await;
    for entry in &payload.domains {
        tls.prefetch_cert(&entry.host).await;
    }
    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── compute_cache_key ────────────────────────────────────────

    #[test]
    fn test_cache_key_deterministic() {
        let k1 = compute_cache_key("GET", "example.com", "/foo", "bar=1");
        let k2 = compute_cache_key("GET", "example.com", "/foo", "bar=1");
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 64);
    }

    #[test]
    fn test_cache_key_different_method() {
        let get = compute_cache_key("GET", "example.com", "/foo", "");
        let post = compute_cache_key("POST", "example.com", "/foo", "");
        assert_ne!(get, post);
    }

    // ── parse_cache_control ──────────────────────────────────────

    #[test]
    fn test_no_store() {
        assert_eq!(parse_cache_control(Some("no-store"), None), CacheDirective::NoStore);
    }

    #[test]
    fn test_no_cache() {
        assert_eq!(parse_cache_control(Some("no-cache"), None), CacheDirective::NoStore);
    }

    #[test]
    fn test_private() {
        assert_eq!(parse_cache_control(Some("private"), None), CacheDirective::NoStore);
    }

    #[test]
    fn test_max_age() {
        assert_eq!(
            parse_cache_control(Some("max-age=300"), None),
            CacheDirective::Cacheable(Some(Duration::from_secs(300)))
        );
    }

    #[test]
    fn test_s_maxage_beats_max_age() {
        assert_eq!(
            parse_cache_control(Some("max-age=300, s-maxage=600"), None),
            CacheDirective::Cacheable(Some(Duration::from_secs(600)))
        );
    }

    #[test]
    fn test_no_header() {
        assert_eq!(parse_cache_control(None, None), CacheDirective::Cacheable(None));
    }

    #[test]
    fn test_pragma_no_cache() {
        assert_eq!(parse_cache_control(None, Some("no-cache")), CacheDirective::NoStore);
    }
}
