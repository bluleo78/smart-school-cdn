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
use clients::optimizer_client::OptimizerClient;
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
    pub optimizer:   Arc<Mutex<OptimizerClient>>,   // optimizer gRPC 클라이언트
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

/// 이미지 콘텐츠 최적화 대상 여부 — image/jpeg, image/png만 optimizer 호출
fn should_optimize(content_type: Option<&str>) -> bool {
    matches!(
        content_type.unwrap_or("").split(';').next().unwrap_or("").trim(),
        "image/jpeg" | "image/png"
    )
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
                let domain = host.split(':').next().unwrap_or(&host).to_string();

                // 이미지 콘텐츠: optimizer gRPC로 WebP 변환 시도
                let (store_body, store_ct) = if should_optimize(content_type.as_deref()) {
                    let ct = content_type.clone().unwrap_or_default();
                    let opt_result = ps.optimizer.lock().await
                        .optimize(response_body.clone(), ct, &domain)
                        .await;
                    match opt_result {
                        Some((opt_bytes, opt_ct)) => (opt_bytes, Some(opt_ct)),
                        None => (response_body.clone(), content_type.clone()),
                    }
                } else {
                    (response_body.clone(), content_type.clone())
                };

                ps.storage.lock().await
                    .put(key, &full_url, &host, store_ct, store_body, Some(ttl))
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
    let pem = ps.tls_client.lock().await.get_ca_cert_pem();
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
    let pem = ps.tls_client.lock().await.get_ca_cert_pem();
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
    let pem = admin.tls_client.lock().await.get_ca_cert_pem();
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
    use axum::body::to_bytes;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    // ─── Mock gRPC 서버 ──────────────────────────────────────────────

    use cdn_proto::storage::{
        storage_service_server::{StorageService, StorageServiceServer},
        GetRequest, GetResponse, PutRequest, PutResponse,
        PurgeRequest, PurgeResponse, StatsRequest, StatsResponse,
        PopularRequest, PopularResponse,
        HealthRequest as StorageHealthRequest, HealthResponse as StorageHealthResponse,
        DomainStat, PopularEntry,
    };
    use cdn_proto::tls::{
        tls_service_server::{TlsService, TlsServiceServer},
        CertRequest, CertResponse, CertInfo, CertListResponse,
        CaCertResponse, SyncDomainsRequest, SyncDomainsResponse,
        Empty,
        HealthRequest as TlsHealthRequest, HealthResponse as TlsHealthResponse,
    };
    use cdn_proto::optimizer::{
        optimizer_service_server::{OptimizerService, OptimizerServiceServer},
        OptimizeRequest, OptimizeResponse,
        GetProfilesResponse, SetProfileRequest, GetStatsResponse,
        Empty as OptimizerEmpty, HealthResponse as OptimizerHealthResponse,
    };
    use std::sync::Mutex as StdMutex;

    /// Mock Storage gRPC 서비스 — 인메모리 맵으로 get/put/purge/stats/popular 구현
    #[derive(Default)]
    struct MockStorage {
        /// key → (body, content_type)
        data: StdMutex<HashMap<String, (Vec<u8>, String)>>,
    }

    #[tonic::async_trait]
    impl StorageService for MockStorage {
        async fn get(
            &self,
            req: tonic::Request<GetRequest>,
        ) -> Result<tonic::Response<GetResponse>, tonic::Status> {
            let data = self.data.lock().unwrap();
            let key = &req.into_inner().key;
            match data.get(key) {
                Some((body, ct)) => Ok(tonic::Response::new(GetResponse {
                    hit: true,
                    body: body.clone(),
                    content_type: ct.clone(),
                })),
                None => Ok(tonic::Response::new(GetResponse {
                    hit: false,
                    body: vec![],
                    content_type: String::new(),
                })),
            }
        }

        async fn put(
            &self,
            req: tonic::Request<PutRequest>,
        ) -> Result<tonic::Response<PutResponse>, tonic::Status> {
            let inner = req.into_inner();
            self.data
                .lock()
                .unwrap()
                .insert(inner.key, (inner.body, inner.content_type));
            Ok(tonic::Response::new(PutResponse {}))
        }

        async fn purge(
            &self,
            _: tonic::Request<PurgeRequest>,
        ) -> Result<tonic::Response<PurgeResponse>, tonic::Status> {
            Ok(tonic::Response::new(PurgeResponse {
                purged_files: 1,
                freed_bytes: 100,
            }))
        }

        async fn stats(
            &self,
            _: tonic::Request<StatsRequest>,
        ) -> Result<tonic::Response<StatsResponse>, tonic::Status> {
            Ok(tonic::Response::new(StatsResponse {
                hit_rate: 0.0,
                used_bytes: 1024,
                total_bytes: 10240,
                domain_stats: vec![DomainStat {
                    domain: "test.com".into(),
                    size_bytes: 512,
                    file_count: 5,
                    hit_rate: 0.0,
                }],
            }))
        }

        async fn popular(
            &self,
            _: tonic::Request<PopularRequest>,
        ) -> Result<tonic::Response<PopularResponse>, tonic::Status> {
            Ok(tonic::Response::new(PopularResponse {
                entries: vec![PopularEntry {
                    url: "https://test.com/img.jpg".into(),
                    domain: "test.com".into(),
                    size_bytes: 100,
                    hit_count: 42,
                }],
            }))
        }

        async fn health(
            &self,
            _: tonic::Request<StorageHealthRequest>,
        ) -> Result<tonic::Response<StorageHealthResponse>, tonic::Status> {
            Ok(tonic::Response::new(StorageHealthResponse {
                online: true,
                latency_ms: 0,
            }))
        }
    }

    /// Mock TLS gRPC 서비스 — get_ca_cert는 빈 PEM을 반환하고, 인증서 목록 포함
    #[derive(Default)]
    struct MockTls;

    /// 테스트용 자체 서명 CA PEM (rustls-pemfile 파싱 없이 get_ca_cert_pem()만 사용)
    const MOCK_CA_PEM: &str = "mock-ca-pem";

    #[tonic::async_trait]
    impl TlsService for MockTls {
        async fn get_ca_cert(
            &self,
            _: tonic::Request<Empty>,
        ) -> Result<tonic::Response<CaCertResponse>, tonic::Status> {
            Ok(tonic::Response::new(CaCertResponse {
                cert_pem: MOCK_CA_PEM.to_string(),
            }))
        }

        async fn get_or_issue_cert(
            &self,
            _: tonic::Request<CertRequest>,
        ) -> Result<tonic::Response<CertResponse>, tonic::Status> {
            Ok(tonic::Response::new(CertResponse {
                found: false,
                cert_pem: String::new(),
                key_pem: String::new(),
            }))
        }

        async fn list_certificates(
            &self,
            _: tonic::Request<Empty>,
        ) -> Result<tonic::Response<CertListResponse>, tonic::Status> {
            Ok(tonic::Response::new(CertListResponse {
                certs: vec![CertInfo {
                    domain: "example.com".into(),
                    issued_at: "2026-01-01T00:00:00Z".into(),
                    expires_at: "2027-01-01T00:00:00Z".into(),
                    status: "active".into(),
                }],
            }))
        }

        async fn sync_domains(
            &self,
            _: tonic::Request<SyncDomainsRequest>,
        ) -> Result<tonic::Response<SyncDomainsResponse>, tonic::Status> {
            Ok(tonic::Response::new(SyncDomainsResponse { success: true }))
        }

        async fn health(
            &self,
            _: tonic::Request<TlsHealthRequest>,
        ) -> Result<tonic::Response<TlsHealthResponse>, tonic::Status> {
            Ok(tonic::Response::new(TlsHealthResponse {
                online: true,
                latency_ms: 0,
            }))
        }
    }

    /// 임시 TCP 리스너에서 인프로세스 gRPC 서버 시작 — 주소 문자열 반환
    async fn start_mock_storage_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = StorageServiceServer::new(MockStorage::default());
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    async fn start_mock_tls_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = TlsServiceServer::new(MockTls);
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    /// Mock Optimizer gRPC 서비스 — 원본 데이터를 그대로 반환 (pass-through)
    #[derive(Default)]
    struct MockOptimizer;

    #[tonic::async_trait]
    impl OptimizerService for MockOptimizer {
        async fn optimize(
            &self,
            req: tonic::Request<OptimizeRequest>,
        ) -> Result<tonic::Response<OptimizeResponse>, tonic::Status> {
            let inner = req.into_inner();
            let size = inner.data.len() as i64;
            // 테스트에서는 원본 그대로 반환 — 기존 테스트 동작에 영향 없음
            Ok(tonic::Response::new(OptimizeResponse {
                data: inner.data,
                content_type: inner.content_type,
                original_size: size,
                optimized_size: size,
            }))
        }

        async fn get_profiles(
            &self,
            _: tonic::Request<OptimizerEmpty>,
        ) -> Result<tonic::Response<GetProfilesResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetProfilesResponse { profiles: vec![] }))
        }

        async fn set_profile(
            &self,
            _: tonic::Request<SetProfileRequest>,
        ) -> Result<tonic::Response<OptimizerEmpty>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerEmpty {}))
        }

        async fn get_stats(
            &self,
            _: tonic::Request<OptimizerEmpty>,
        ) -> Result<tonic::Response<GetStatsResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetStatsResponse { stats: vec![] }))
        }

        async fn health(
            &self,
            _: tonic::Request<OptimizerEmpty>,
        ) -> Result<tonic::Response<OptimizerHealthResponse>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerHealthResponse {
                online: true,
                latency_ms: 0,
            }))
        }
    }

    async fn start_mock_optimizer_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = OptimizerServiceServer::new(MockOptimizer);
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    /// 테스트용 AdminState 생성 — mock gRPC 서버에 연결
    async fn make_test_admin_state() -> (
        state::SharedState,
        Arc<Mutex<clients::storage_client::StorageClient>>,
        Arc<Mutex<clients::tls_client::TlsClient>>,
        DomainMap,
        clients::tls_client::CertCache,
    ) {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        // gRPC 서버 기동 대기 (짧은 재시도)
        let storage = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };

        let cert_cache = tls.cert_cache.clone();
        let shared = Arc::new(tokio::sync::RwLock::new(state::AppState::new()));
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(HashMap::new()));

        (
            shared,
            Arc::new(Mutex::new(storage)),
            Arc::new(Mutex::new(tls)),
            domain_map,
            cert_cache,
        )
    }

    // ─── Admin 라우터 핸들러 테스트 ─────────────────────────────────────

    /// /status → 200 OK, online=true
    #[tokio::test]
    async fn status_handler_현재_상태를_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/status")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["online"], true);
    }

    /// /requests → 200 OK, JSON 배열
    #[tokio::test]
    async fn requests_handler_요청_로그를_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/requests")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.is_array());
    }

    /// /cache/stats → 200 OK, hit_count 필드 포함
    #[tokio::test]
    async fn cache_stats_handler_통계를_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/cache/stats")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.get("hit_count").is_some());
        assert!(json.get("miss_count").is_some());
    }

    /// /cache/popular → 200 OK, entries 배열
    #[tokio::test]
    async fn cache_popular_handler_인기_항목을_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/cache/popular")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.is_array());
        // mock에서 1개 항목 반환
        assert_eq!(json.as_array().unwrap().len(), 1);
        assert_eq!(json[0]["domain"], "test.com");
    }

    /// DELETE /cache/purge?type=url — target 없으면 400
    #[tokio::test]
    async fn cache_purge_handler_target_없으면_400을_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/cache/purge")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(r#"{"type":"url"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    /// DELETE /cache/purge type=url, target 있음 → 200
    #[tokio::test]
    async fn cache_purge_handler_url_퍼지_성공() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/cache/purge")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        r#"{"type":"url","target":"https://test.com/img.jpg"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.get("purged_count").is_some());
    }

    /// DELETE /cache/purge type=domain → 200
    #[tokio::test]
    async fn cache_purge_handler_domain_퍼지_성공() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/cache/purge")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        r#"{"type":"domain","target":"test.com"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    /// DELETE /cache/purge type=all → 200
    #[tokio::test]
    async fn cache_purge_handler_all_퍼지_성공() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/cache/purge")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(r#"{"type":"all"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    /// DELETE /cache/purge type=invalid → purged_count=0
    #[tokio::test]
    async fn cache_purge_handler_invalid_type_은_0을_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/cache/purge")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(r#"{"type":"bogus"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["purged_count"], 0);
    }

    /// /tls/ca → 200, content-type: application/x-pem-file
    #[tokio::test]
    async fn tls_ca_handler_ca_pem을_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/tls/ca")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/x-pem-file"
        );
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        assert!(!body.is_empty());
    }

    /// /tls/certificates → 200, JSON 배열, domain 필드 포함
    #[tokio::test]
    async fn tls_certificates_handler_인증서_목록을_반환한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/tls/certificates")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json.is_array());
        assert_eq!(json[0]["domain"], "example.com");
    }

    /// POST /domains → 200, 도메인 맵 갱신
    #[tokio::test]
    async fn update_domains_handler_도메인_맵을_갱신한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;
        let domain_map_check = domain_map.clone();
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache);

        let resp = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/domains")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        r#"{"domains":[{"host":"cdn.test.com","origin":"https://origin.test.com"}]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        // 도메인 맵이 갱신되었는지 확인
        let map = domain_map_check.read().await;
        assert!(map.contains_key("cdn.test.com"));
    }

    // ─── pem_to_uuid 테스트 ─────────────────────────────────────────────

    /// pem_to_uuid는 동일 입력에 대해 결정론적 출력을 반환한다
    #[test]
    fn pem_to_uuid_는_결정론적_출력을_반환한다() {
        let u1 = pem_to_uuid("test");
        let u2 = pem_to_uuid("test");
        assert_eq!(u1, u2);
        // 다른 입력은 다른 출력
        assert_ne!(pem_to_uuid("a"), pem_to_uuid("b"));
    }

    // ─── proxy 라우터 핸들러 테스트 ────────────────────────────────────

    /// 미등록 도메인 요청 → 404 Not Found
    #[tokio::test]
    async fn proxy_handler_미등록_도메인은_404를_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        let storage = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(HashMap::new()));
        let optimizer_url = start_mock_optimizer_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Arc::new(Mutex::new(optimizer)),
            domain_map,
            cert_cache,
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/some/path")
                    .header("host", "unknown.example.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    /// Host 헤더 없는 요청 → 400 Bad Request
    #[tokio::test]
    async fn proxy_handler_host_헤더_없으면_400을_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        let storage = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(HashMap::new()));
        let optimizer_url = start_mock_optimizer_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Arc::new(Mutex::new(optimizer)),
            domain_map,
            cert_cache,
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/")
                    // host 헤더 없음
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    /// /ca.crt 요청 → 200, application/x-pem-file
    #[tokio::test]
    async fn ca_cert_handler_pem_파일을_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        let storage = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let optimizer_url = start_mock_optimizer_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Arc::new(Mutex::new(optimizer)),
            domain_map: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            cert_cache,
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/ca.crt")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/x-pem-file"
        );
    }

    /// /ca.mobileconfig → 200, application/x-apple-aspen-config
    #[tokio::test]
    async fn ca_mobileconfig_handler_mobileconfig를_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        let storage = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let optimizer_url = start_mock_optimizer_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Arc::new(Mutex::new(optimizer)),
            domain_map: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            cert_cache,
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/ca.mobileconfig")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/x-apple-aspen-config"
        );
    }

    /// proxy_handler: 등록 도메인 + 캐시 HIT → X-Cache-Status: HIT
    #[tokio::test]
    async fn proxy_handler_캐시_hit_시_hit_헤더를_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;

        let storage_client = loop {
            match clients::storage_client::StorageClient::connect(&storage_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let tls = loop {
            match clients::tls_client::TlsClient::connect(&tls_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();

        // 캐시 키를 미리 계산하여 mock storage에 직접 삽입
        let cache_key = compute_cache_key("GET", "cached.test.com", "/img.jpg", "");
        {
            // storage gRPC put 직접 호출 대신 내부 인메모리 삽입은 불가하므로
            // StorageClient::put()을 통해 넣는다
            let mut sc = storage_client.clone();
            sc.put(
                &cache_key,
                "https://cached.test.com/img.jpg",
                "cached.test.com",
                Some("image/jpeg".to_string()),
                bytes::Bytes::from("fake-image-data"),
                None,
            )
            .await;
        }

        let mut domain_map_inner = HashMap::new();
        domain_map_inner.insert(
            "cached.test.com".to_string(),
            "https://origin.test.com".to_string(),
        );
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(domain_map_inner));

        let optimizer_url = start_mock_optimizer_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage_client)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Arc::new(Mutex::new(optimizer)),
            domain_map,
            cert_cache,
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/img.jpg")
                    .header("host", "cached.test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("x-cache-status").unwrap(),
            "HIT"
        );
    }

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

    #[test]
    fn should_optimize_은_이미지_타입만_true를_반환한다() {
        assert!(should_optimize(Some("image/jpeg")));
        assert!(should_optimize(Some("image/png")));
        assert!(!should_optimize(Some("image/webp")));
        assert!(!should_optimize(Some("image/avif")));
        assert!(!should_optimize(Some("text/html")));
        assert!(!should_optimize(Some("application/javascript")));
        assert!(!should_optimize(None));
        // content-type with charset
        assert!(should_optimize(Some("image/jpeg; charset=utf-8")));
    }
}
