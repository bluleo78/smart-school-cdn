/// Proxy 서비스의 라이브러리 진입점
pub mod clients;
pub mod coalescer;
pub mod compress;
pub mod config;
pub mod events;
pub mod range;
pub mod state;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};
use bytes::Bytes;
use coalescer::Coalescer;

use sha2::{Digest, Sha256};
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Json, Response};
use axum::extract::Path;
use axum::routing::{delete, get};
use axum::Router;
use state::{RequestLog, SharedState};
use clients::optimizer_client::OptimizerClient;
use clients::storage_client::StorageClient;
use clients::tls_client::{TlsClient, CertCache};

/// L1 메모리 캐시 항목 — body + content_type + Phase 15 brotli 변형(옵셔널)
pub struct MemoryCacheEntry {
    pub body: Bytes,
    pub content_type: Option<String>,
    pub body_br: Option<Bytes>,
}

/// 런타임에 교체 가능한 도메인→원본서버 맵
pub type DomainMap = Arc<RwLock<HashMap<String, String>>>;

/// 도메인별 요청 통계 카운터 (lock-free atomic 연산)
/// L1/L2 히트, 4종 bypass, miss를 개별 집계한다
pub struct DomainCounter {
    pub requests:          AtomicU64,
    pub l1_hits:           AtomicU64,
    pub l2_hits:           AtomicU64,
    pub cache_misses:      AtomicU64,
    pub bypass_method:     AtomicU64,
    pub bypass_nocache:    AtomicU64,
    pub bypass_size:       AtomicU64,
    pub bypass_other:      AtomicU64,
    pub bandwidth:         AtomicU64,
    pub response_time_sum: AtomicU64,
}

/// 도메인 카운터 스냅샷 — swap_reset() 반환값
pub struct DomainStatsSnapshot {
    pub requests:      u64,
    pub l1_hits:       u64,
    pub l2_hits:       u64,
    pub cache_misses:  u64,
    pub bypass_method: u64,
    pub bypass_nocache: u64,
    pub bypass_size:   u64,
    pub bypass_other:  u64,
    /// 하위 호환 파생값 (= l1_hits + l2_hits)
    pub cache_hits:    u64,
    pub bandwidth:     u64,
    pub response_time_sum: u64,
}

impl DomainCounter {
    pub fn new() -> Self {
        Self {
            requests:          AtomicU64::new(0),
            l1_hits:           AtomicU64::new(0),
            l2_hits:           AtomicU64::new(0),
            cache_misses:      AtomicU64::new(0),
            bypass_method:     AtomicU64::new(0),
            bypass_nocache:    AtomicU64::new(0),
            bypass_size:       AtomicU64::new(0),
            bypass_other:      AtomicU64::new(0),
            bandwidth:         AtomicU64::new(0),
            response_time_sum: AtomicU64::new(0),
        }
    }

    /// 카운터를 읽고 0으로 원자적 리셋 — 통계 수집 후 초기화용
    pub fn take(&self) -> DomainStatsSnapshot {
        let requests       = self.requests.swap(0, Ordering::Relaxed);
        let l1_hits        = self.l1_hits.swap(0, Ordering::Relaxed);
        let l2_hits        = self.l2_hits.swap(0, Ordering::Relaxed);
        let cache_misses   = self.cache_misses.swap(0, Ordering::Relaxed);
        let bypass_method  = self.bypass_method.swap(0, Ordering::Relaxed);
        let bypass_nocache = self.bypass_nocache.swap(0, Ordering::Relaxed);
        let bypass_size    = self.bypass_size.swap(0, Ordering::Relaxed);
        let bypass_other   = self.bypass_other.swap(0, Ordering::Relaxed);
        let bandwidth      = self.bandwidth.swap(0, Ordering::Relaxed);
        let response_time_sum = self.response_time_sum.swap(0, Ordering::Relaxed);
        let cache_hits = l1_hits + l2_hits;
        DomainStatsSnapshot {
            requests, l1_hits, l2_hits, cache_misses,
            bypass_method, bypass_nocache, bypass_size, bypass_other,
            cache_hits, bandwidth, response_time_sum,
        }
    }
}

/// 도메인별 카운터 맵 — std::sync::RwLock 사용 (짧은 임계 구간, AtomicU64는 lock-free)
pub type DomainCounters = Arc<std::sync::RwLock<HashMap<String, DomainCounter>>>;

/// 도메인 요청 카운터 증가 — read lock 우선 시도, 없으면 write lock으로 entry 생성
/// outcome을 통해 L1/L2 히트·miss·bypass 4종을 개별 집계한다
fn record_domain_outcome(
    counters: &DomainCounters,
    host: &str,
    outcome: CacheOutcome,
    bandwidth: u64,
    response_time_ms: u64,
) {
    {
        let map = counters.read().unwrap();
        if let Some(c) = map.get(host) {
            c.requests.fetch_add(1, Ordering::Relaxed);
            match outcome {
                CacheOutcome::L1Hit         => { c.l1_hits.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::L2Hit         => { c.l2_hits.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::Miss          => { c.cache_misses.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::BypassMethod  => { c.bypass_method.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::BypassNoCache => { c.bypass_nocache.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::BypassSize    => { c.bypass_size.fetch_add(1, Ordering::Relaxed); }
                CacheOutcome::BypassOther   => { c.bypass_other.fetch_add(1, Ordering::Relaxed); }
            }
            c.bandwidth.fetch_add(bandwidth, Ordering::Relaxed);
            c.response_time_sum.fetch_add(response_time_ms, Ordering::Relaxed);
            return;
        }
    }
    let mut map = counters.write().unwrap();
    let c = map.entry(host.to_string()).or_insert_with(DomainCounter::new);
    c.requests.fetch_add(1, Ordering::Relaxed);
    match outcome {
        CacheOutcome::L1Hit         => { c.l1_hits.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::L2Hit         => { c.l2_hits.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::Miss          => { c.cache_misses.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::BypassMethod  => { c.bypass_method.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::BypassNoCache => { c.bypass_nocache.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::BypassSize    => { c.bypass_size.fetch_add(1, Ordering::Relaxed); }
        CacheOutcome::BypassOther   => { c.bypass_other.fetch_add(1, Ordering::Relaxed); }
    }
    c.bandwidth.fetch_add(bandwidth, Ordering::Relaxed);
    c.response_time_sum.fetch_add(response_time_ms, Ordering::Relaxed);
}

/// 프록시 핸들러 공유 상태
#[derive(Clone)]
pub struct ProxyState {
    pub shared:      SharedState,
    pub http_client: reqwest::Client,
    pub storage:     Arc<Mutex<StorageClient>>,
    pub tls_client:  Arc<Mutex<TlsClient>>,
    pub optimizer:   Option<Arc<Mutex<OptimizerClient>>>,   // optimizer gRPC 클라이언트 (없으면 최적화 비활성화)
    pub domain_map:  DomainMap,
    pub cert_cache:  CertCache,
    pub coalescer:   Arc<Coalescer>,
    /// L1 메모리 캐시 — moka async cache (key: SHA-256 hex, value: body + content_type)
    pub memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>>,
    /// 도메인별 요청 통계 카운터
    pub counters: DomainCounters,
    /// 최적화 이벤트 배치 push 송신자 — None이면 이벤트 수집 비활성화
    pub events: Option<events::EventsSender>,
    /// Phase 15: 텍스트 압축 설정
    pub text_compress: TextCompressConfig,
}

/// 관리 API 핸들러 상태
#[derive(Clone)]
#[allow(dead_code)]
struct AdminState {
    state:        SharedState,
    storage:      Arc<Mutex<StorageClient>>,
    tls_client:   Arc<Mutex<TlsClient>>,
    domain_map:   DomainMap,
    cert_cache:   CertCache,
    memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>>,
    counters:     DomainCounters,
}

/// 기본 캐시 TTL (Cache-Control 헤더 없을 때)
const DEFAULT_TTL: Duration = Duration::from_secs(3600);

/// L2 storage에 저장 가능한 단일 응답 최대 크기 (128 MB)
/// 이 크기를 초과하면 BypassSize로 분류하고 캐시에 저장하지 않는다.
/// 학교 교과서 SCORM 패키지·비디오 파일까지 수용할 수 있도록 넉넉히 설정.
// 불변: MAX_CACHE_ENTRY_BYTES >= MAX_MEMORY_ENTRY_BYTES —
// L1 캐시가 L2 캐시보다 작은 상한을 갖도록 한다.
const MAX_CACHE_ENTRY_BYTES: u64 = 128 * 1024 * 1024;

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
    memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>>,
    counters:     DomainCounters,
) -> Router {
    let admin_state = AdminState { state: shared_state, storage, tls_client, domain_map, cert_cache, memory_cache, counters };
    Router::new()
        .route("/status", get(status_handler))
        .route("/requests", get(requests_handler))
        .route("/cache/stats", get(cache_stats_handler))
        .route("/cache/popular", get(cache_popular_handler))
        .route("/cache/purge", delete(cache_purge_handler))
        .route("/tls/ca", get(tls_ca_handler))
        .route("/tls/certificates", get(tls_certificates_handler))
        .route("/domains", axum::routing::post(update_domains_handler))
        .route("/domains/{host}/purge", axum::routing::post(domain_purge_handler))
        .route("/stats", get(stats_handler))
        .with_state(admin_state)
}

// ─── 캐시 키·파싱 유틸 (기존 cache.rs에서 이전) ───────────────────

/// HTTP 요청에서 캐시 키 계산 — SHA-256 hex string 반환
fn compute_cache_key(method: &str, host: &str, path: &str, query: &str) -> String {
    let input = format!("{method}:{host}{path}?{query}");
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(hash)
}

/// Phase 15: 텍스트 압축 설정 — 환경변수로만 조정.
#[derive(Debug, Clone, Copy)]
pub struct TextCompressConfig {
    pub enabled:    bool,
    pub min_bytes:  usize,
    pub br_level:   u32,
    pub gzip_level: u32,
    /// DoS 방어용 상한 — 이 크기를 초과하는 텍스트는 압축 스킵 (기본 8MB)
    pub max_bytes:  usize,
}

impl TextCompressConfig {
    pub fn from_env() -> Self {
        let enabled = std::env::var("TEXT_COMPRESS_ENABLED")
            .map(|v| v != "0" && v.to_ascii_lowercase() != "false")
            .unwrap_or(true);
        let min_bytes = std::env::var("TEXT_COMPRESS_MIN_BYTES")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(1024);
        let br_level = std::env::var("TEXT_COMPRESS_BR_LEVEL")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(11);
        let gzip_level = std::env::var("TEXT_COMPRESS_GZIP_LEVEL")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(6);
        let max_bytes = std::env::var("TEXT_COMPRESS_MAX_BYTES")
            .ok().and_then(|v| v.parse().ok()).unwrap_or(8_388_608);
        Self { enabled, min_bytes, br_level, gzip_level, max_bytes }
    }
}

/// 이미지 콘텐츠 최적화 대상 여부 — optimizer-service가 디코드 가능한 포맷 전체.
/// Phase 14: JPEG/PNG 외에 WebP/GIF/BMP/TIFF도 포함(리사이즈·size-guard 대상).
fn should_optimize(content_type: Option<&str>) -> bool {
    matches!(
        content_type.unwrap_or("").split(';').next().unwrap_or("").trim(),
        "image/jpeg" | "image/png" | "image/webp"
        | "image/gif"  | "image/bmp" | "image/tiff"
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

/// 정적 자원 확장자 화이트리스트 — origin `Cache-Control: no-store` override 대상.
/// URL 확장자 기반만 사용해 동적 API 경로(`/api/xxx`)나 확장자 없는 경로는 절대 영향받지 않는다.
fn is_static_extension(path: &str) -> bool {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .split(|c: char| !c.is_ascii_alphanumeric())
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        // 오디오·비디오
        "mp4" | "m4v" | "mov" | "avi" | "webm" | "mpg" | "mpeg"
            | "mp3" | "m4a" | "aac" | "flac" | "wav" | "ogg"
        // 이미지
            | "png" | "jpg" | "jpeg" | "gif" | "ico" | "svg" | "webp"
        // 폰트
            | "woff" | "woff2" | "ttf" | "otf"
        // 스크립트·스타일·WASM
            | "js" | "css" | "wasm"
    )
}

/// Range 헤더 평가 결과 — 응답 상태/body 슬라이스 결정의 근거가 된다.
#[derive(Debug, PartialEq, Eq)]
enum RangeOutcome {
    /// Range 헤더 없음 또는 파싱 실패(멀티레인지 등) → 200 + 전체 body
    Full,
    /// 정상 단일 범위 → 206 + (start, end_inclusive)
    Partial { start: u64, end: u64 },
    /// 파싱은 성공했으나 총 크기를 벗어남 → 416 Range Not Satisfiable
    Invalid,
}

/// HIT 응답 바디 선택 — Accept-Encoding 협상 결과에 따라 원본/br/gzip 중 하나 반환.
/// Range 요청 또는 body_br 부재 시 원본(identity) 반환.
/// 반환: (body_to_send, Option<content_encoding_header_value>)
fn select_encoded_body(
    body: &Bytes,
    body_br: Option<&Bytes>,
    has_range: bool,
    gzip_level: u32,
    accept_encoding: Option<&str>,
) -> (Bytes, Option<&'static str>) {
    if has_range || body_br.is_none() {
        return (body.clone(), None);
    }
    match compress::negotiate_encoding(accept_encoding) {
        compress::Encoding::Br => (body_br.unwrap().clone(), Some("br")),
        compress::Encoding::Gzip => {
            match compress::decompress_brotli(body_br.unwrap()) {
                Ok(raw) => match compress::encode_gzip(&raw, gzip_level) {
                    Ok(gz) => (Bytes::from(gz), Some("gzip")),
                    Err(_) => (body.clone(), None),
                },
                Err(_) => (body.clone(), None),
            }
        }
        compress::Encoding::Identity => (body.clone(), None),
    }
}

/// 요청 헤더와 전체 바이트 크기를 받아 RangeOutcome 계산.
fn evaluate_range(headers: &HeaderMap, total_size: u64) -> RangeOutcome {
    let Some(raw) = headers
        .get(axum::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
    else {
        return RangeOutcome::Full;
    };
    // parse 실패(멀티레인지·비표준 단위)는 RFC 7233 §3.1 권고대로 200 fallback
    let Some(byte_range) = range::parse_byte_range(raw) else {
        return RangeOutcome::Full;
    };
    match range::resolve_range(byte_range, total_size) {
        Some((start, end)) => RangeOutcome::Partial { start, end },
        None => RangeOutcome::Invalid,
    }
}

/// Phase 13 관찰 대상 — 미디어(오디오/비디오) 요청 여부 판정.
/// URL 확장자 우선, 차선으로 Content-Type 의 base가 video/·audio/ 로 시작하는지 확인한다.
fn is_media_request(path: &str, content_type: Option<&str>) -> bool {
    // path 마지막 `.` 이후 → 알파뉴메릭 prefix 추출 (쿼리·프래그먼트 방어)
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .split(|c: char| !c.is_ascii_alphanumeric())
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        ext.as_str(),
        "mp4" | "m4v" | "mov" | "avi" | "webm" | "mpg" | "mpeg"
            | "mp3" | "m4a" | "aac" | "flac" | "wav" | "ogg"
    ) {
        return true;
    }
    if let Some(ct) = content_type {
        let base = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        if base.starts_with("video/") || base.starts_with("audio/") {
            return true;
        }
    }
    false
}

/// 미디어 요청이면 배치 푸셔로 이벤트 송출 — Phase 13 범위에서는 `media_cache`만 대상.
/// `decision`은 Range 결과까지 포함해 호출자가 구체적인 문자열을 지정한다
/// (예: "l1_hit", "l1_hit_206", "l1_hit_416").
fn emit_media_cache_event(
    events_sender: &Option<events::EventsSender>,
    host: &str,
    uri: &Uri,
    decision: &str,
    orig_size: Option<u64>,
    out_size: Option<u64>,
    headers: &HeaderMap,
    content_type: Option<&str>,
    elapsed_ms: u64,
) {
    let Some(sender) = events_sender else { return };
    if !is_media_request(uri.path(), content_type) {
        return;
    }
    let range_header = headers
        .get(axum::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    sender.emit(events::EventRecord {
        event_type: "media_cache",
        host: host.to_string(),
        url: uri.to_string(),
        decision: decision.to_string(),
        orig_size,
        out_size,
        range_header,
        content_type: content_type.map(str::to_string),
        elapsed_ms,
    });
}

/// 응답이 캐시 가능한 콘텐츠 타입인지 판정.
/// 학교 교과서 CDN 워크로드(이미지·텍스트·폰트·JS/JSON·PDF·EPUB·오디오/비디오·WASM)를 대상으로 한다.
fn is_cacheable_content_type(content_type: &str) -> bool {
    content_type.starts_with("image/")
        || content_type.starts_with("text/")
        || content_type.starts_with("font/")
        || content_type.starts_with("video/")
        || content_type.starts_with("audio/")
        || content_type == "application/javascript"
        || content_type == "application/json"
        || content_type == "application/octet-stream"
        || content_type == "application/pdf"
        || content_type == "application/wasm"
        || content_type == "application/epub+zip"
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
    let state = ps.shared.clone();
    let client = ps.http_client.clone();

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

    // GET/HEAD 요청을 캐시 대상으로 처리 — HEAD는 GET과 동일 키 사용 (RFC 7231 §4.3.2)
    let cache_key = if method == Method::GET || method == Method::HEAD {
        Some(compute_cache_key(
            "GET",
            &host,
            uri.path(),
            uri.query().unwrap_or(""),
        ))
    } else {
        None
    };

    // ── L1 메모리 캐시 확인 ──────────────────────────────────────
    if let Some(ref key) = cache_key {
        if let Some(entry) = ps.memory_cache.get(key).await {
            let elapsed_ms = start.elapsed().as_millis() as u64;
            // Range 헤더 평가 — 있으면 206 슬라이스, 범위 초과면 416, 없거나 파싱 실패면 200
            let total = entry.body.len() as u64;
            let is_head = method == Method::HEAD;
            // HEAD는 압축 협상 스킵 — Content-Length는 원본 크기 기준
            let has_range_req = is_head || headers.get(axum::http::header::RANGE).is_some();
            let ae = headers.get(axum::http::header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok());

            let (resp_status, resp_body, content_range_hdr, decision, out_bytes, content_encoding) =
                match evaluate_range(&headers, total) {
                    RangeOutcome::Full => {
                        let (negotiated_body, ce) = select_encoded_body(
                            &entry.body,
                            entry.body_br.as_ref(),
                            has_range_req,
                            ps.text_compress.gzip_level,
                            ae,
                        );
                        let out = negotiated_body.len() as u64;
                        (
                            StatusCode::OK, negotiated_body, None,
                            CacheOutcome::L1Hit.as_header().to_string(), out, ce,
                        )
                    }
                    RangeOutcome::Partial { start, end } => {
                        let sliced = entry.body.slice(start as usize..=end as usize);
                        let len = sliced.len() as u64;
                        (
                            StatusCode::PARTIAL_CONTENT, sliced,
                            Some(range::format_content_range(start, end, total)),
                            format!("{}_206", CacheOutcome::L1Hit.as_header()), len, None,
                        )
                    }
                    RangeOutcome::Invalid => (
                        StatusCode::RANGE_NOT_SATISFIABLE, Bytes::new(),
                        Some(range::format_content_range_unsatisfied(total)),
                        format!("{}_416", CacheOutcome::L1Hit.as_header()), 0, None,
                    ),
                };

            {
                let mut app_state = state.write().await;
                app_state.record_memory_hit();
                app_state.record_request(RequestLog {
                    method: method.to_string(),
                    host: host.clone(),
                    url: uri.to_string(),
                    status_code: resp_status.as_u16(),
                    response_time_ms: elapsed_ms,
                    timestamp: chrono::Utc::now(),
                    cache_status: "HIT".to_string(),
                });
            }
            tracing::info!(host=%host, url=%uri, elapsed_ms=%elapsed_ms, status=%resp_status.as_u16(), "L1 메모리 캐시 HIT");
            record_domain_outcome(&ps.counters, &host, CacheOutcome::L1Hit, total, elapsed_ms);
            emit_media_cache_event(
                &ps.events, &host, &uri, &decision,
                Some(total), Some(out_bytes),
                &headers, entry.content_type.as_deref(), elapsed_ms,
            );

            // HEAD만 Content-Length를 원본 크기로 명시(RFC 7231 §4.3.2).
            // GET 응답의 Content-Length는 axum이 body 크기에서 자동 산출 — br/gzip 변형
            // 반환 시 body.len()과 헤더가 어긋나지 않도록 수동 설정 금지.
            let body_for_resp = if is_head { Bytes::new() } else { resp_body };

            let mut resp = Response::builder()
                .status(resp_status)
                .header("Accept-Ranges", "bytes");
            if is_head {
                resp = resp.header("Content-Length", entry.body.len().to_string());
            }
            if let Some(ref ct) = entry.content_type {
                resp = resp.header("Content-Type", ct.as_str());
            }
            if let Some(cr) = content_range_hdr {
                resp = resp.header("Content-Range", cr);
            }
            // Phase 15: Accept-Encoding 협상 결과 헤더 (HEAD에서는 스킵)
            if !is_head {
                if let Some(enc) = content_encoding {
                    resp = resp.header("Content-Encoding", enc);
                }
            }
            if entry.body_br.is_some() {
                resp = resp.header("Vary", "Accept-Encoding");
            }
            return resp
                .header("X-Cache-Status", HeaderValue::from_static("HIT"))
                .header("X-Cache-Reason", HeaderValue::from_static(CacheOutcome::L1Hit.as_header()))
                .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
                .body(Body::from(body_for_resp))
                .unwrap();
        }
    }

    // ── L2 디스크 캐시 확인 (storage gRPC) ───────────────────────
    if let Some(ref key) = cache_key {
        if let Some((cached_bytes, content_type, cached_br)) = ps.storage.lock().await.get(key).await {
            // Vec<u8> → Bytes로 한 번 변환 (이후 clone은 Arc refcount 증가라 저렴)
            let body_bytes: Bytes = cached_bytes;
            let total = body_bytes.len() as u64;

            // L2 HIT → L1 승격 (16MB 이하만)
            const MAX_MEMORY_ENTRY_BYTES: usize = 16 * 1024 * 1024;
            if body_bytes.len() <= MAX_MEMORY_ENTRY_BYTES {
                ps.memory_cache.insert(key.clone(), Arc::new(MemoryCacheEntry {
                    body: body_bytes.clone(),
                    content_type: content_type.clone(),
                    body_br: cached_br.clone(),
                })).await;
            }

            let elapsed_ms = start.elapsed().as_millis() as u64;
            let is_head = method == Method::HEAD;
            // HEAD는 압축 협상 스킵 — Content-Length는 원본 크기 기준
            let has_range_req = is_head || headers.get(axum::http::header::RANGE).is_some();
            let ae = headers.get(axum::http::header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok());

            // Range 헤더 평가 — 있으면 206 슬라이스, 범위 초과면 416
            let (resp_status, resp_body, content_range_hdr, decision, out_bytes, content_encoding) =
                match evaluate_range(&headers, total) {
                    RangeOutcome::Full => {
                        let (negotiated_body, ce) = select_encoded_body(
                            &body_bytes,
                            cached_br.as_ref(),
                            has_range_req,
                            ps.text_compress.gzip_level,
                            ae,
                        );
                        let out = negotiated_body.len() as u64;
                        (
                            StatusCode::OK, negotiated_body, None,
                            CacheOutcome::L2Hit.as_header().to_string(), out, ce,
                        )
                    }
                    RangeOutcome::Partial { start, end } => {
                        let sliced = body_bytes.slice(start as usize..=end as usize);
                        let len = sliced.len() as u64;
                        (
                            StatusCode::PARTIAL_CONTENT, sliced,
                            Some(range::format_content_range(start, end, total)),
                            format!("{}_206", CacheOutcome::L2Hit.as_header()), len, None,
                        )
                    }
                    RangeOutcome::Invalid => (
                        StatusCode::RANGE_NOT_SATISFIABLE, Bytes::new(),
                        Some(range::format_content_range_unsatisfied(total)),
                        format!("{}_416", CacheOutcome::L2Hit.as_header()), 0, None,
                    ),
                };

            {
                let mut app_state = state.write().await;
                app_state.record_disk_hit();
                app_state.record_request(RequestLog {
                    method: method.to_string(),
                    host: host.clone(),
                    url: uri.to_string(),
                    status_code: resp_status.as_u16(),
                    response_time_ms: elapsed_ms,
                    timestamp: chrono::Utc::now(),
                    cache_status: "HIT".to_string(),
                });
            }
            tracing::info!(host=%host, url=%uri, elapsed_ms=%elapsed_ms, status=%resp_status.as_u16(), "L2 디스크 캐시 HIT (L1 승격)");
            record_domain_outcome(&ps.counters, &host, CacheOutcome::L2Hit, total, elapsed_ms);
            emit_media_cache_event(
                &ps.events, &host, &uri, &decision,
                Some(total), Some(out_bytes),
                &headers, content_type.as_deref(), elapsed_ms,
            );

            // HEAD만 Content-Length를 원본 크기로 명시(RFC 7231 §4.3.2).
            // GET 응답 Content-Length는 axum이 body 크기에서 자동 산출.
            let body_for_resp = if is_head { Bytes::new() } else { resp_body };

            let mut resp = Response::builder()
                .status(resp_status)
                .header("Accept-Ranges", "bytes");
            if is_head {
                resp = resp.header("Content-Length", body_bytes.len().to_string());
            }
            if let Some(ct) = content_type {
                resp = resp.header("Content-Type", ct);
            }
            if let Some(cr) = content_range_hdr {
                resp = resp.header("Content-Range", cr);
            }
            // Phase 15: Accept-Encoding 협상 결과 헤더 (HEAD에서는 스킵)
            if !is_head {
                if let Some(enc) = content_encoding {
                    resp = resp.header("Content-Encoding", enc);
                }
            }
            if cached_br.is_some() {
                resp = resp.header("Vary", "Accept-Encoding");
            }
            return resp
                .header("X-Cache-Status", HeaderValue::from_static("HIT"))
                .header("X-Cache-Reason", HeaderValue::from_static(CacheOutcome::L2Hit.as_header()))
                .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
                .body(Body::from(body_for_resp))
                .unwrap();
        }
    }

    // ── 요청 본문 읽기 (body는 한 번만 소비 가능 — GET/non-GET 공통) ───
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read request body").into_response(),
    };

    // ── GET MISS: coalescer 경유로 동시 중복 fetch 방지 ──────────────
    if let Some(ref key) = cache_key {
        let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/").to_string();
        let origin_url = format!("{}{}", origin, path_and_query);

        // 정적 확장자(mp4/png/js/css 등)는 origin의 Cache-Control: no-store 를 CDN이 override
        // — 클로저 진입 전에 계산해 move 캡처 (path 매칭만 사용, API 경로 오염 없음)
        let is_static = is_static_extension(uri.path());

        let key_c        = key.clone();
        let host_c       = host.clone();
        let uri_str      = uri.to_string();
        let headers_c    = headers.clone();
        let body_bytes_c = body_bytes.clone();
        let client_c     = client.clone();
        let method_c     = method.clone();
        let ps_c         = ps.clone();
        let state_c      = state.clone();

        let coalesced = ps.coalescer.get_or_fetch(key.clone(), move || async move {
            let key_for_put = key_c;
            // 헤더 필터링 후 원본 요청 빌드
            // Range/If-Range는 제거해 origin에서 항상 full body를 받아온다
            // (클라이언트별 Range는 수신 후 슬라이싱으로 처리)
            let mut req_builder = client_c.request(method_c, &origin_url);
            for (k, v) in headers_c.iter() {
                let name = k.as_str();
                if !matches!(
                    name,
                    "host" | "connection" | "transfer-encoding" | "proxy-connection"
                        | "keep-alive" | "upgrade" | "te" | "trailer"
                        | "range" | "if-range"
                ) {
                    req_builder = req_builder.header(k, v);
                }
            }

            let origin_resp = match req_builder.body(body_bytes_c).send().await {
                Ok(r) => r,
                Err(err) => {
                    tracing::error!(error=%err, url=%origin_url, "원본 서버 연결 실패");
                    return Err(());
                }
            };

            let status = origin_resp.status();
            let resp_headers = origin_resp.headers().clone();

            let cache_directive = {
                let cc = resp_headers.get("cache-control").and_then(|v| v.to_str().ok());
                let pragma = resp_headers.get("pragma").and_then(|v| v.to_str().ok());
                parse_cache_control(cc, pragma)
            };

            let resp_body = match origin_resp.bytes().await {
                Ok(b) => b,
                Err(err) => {
                    tracing::error!(error=%err, "원본 응답 본문 읽기 실패");
                    return Err(());
                }
            };

            let content_type = resp_headers
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            // outcome 분류에 필요한 조건 계산
            // parse_cache_control()이 이미 파싱한 cache_directive를 재사용해 중복 파싱 방지
            // 정적 확장자는 no-store override — 학교 환경에서는 정적 자원의 반복 origin 왕복을 차단
            let origin_no_cache = matches!(cache_directive, CacheDirective::NoStore) && !is_static;
            // 응답 크기가 단일 캐시 항목 최대치 초과 여부
            let size_exceeded = resp_body.len() as u64 > MAX_CACHE_ENTRY_BYTES;
            // 캐시 가능한 Content-Type 여부 — is_cacheable_content_type() 헬퍼로 위임
            let ct_str = content_type.as_deref().unwrap_or("");
            let ct_base = ct_str.split(';').next().unwrap_or("").trim();
            let cacheable_ct = is_cacheable_content_type(ct_base);
            let origin_ok_and_cacheable = status.is_success()
                && !origin_no_cache
                && !size_exceeded
                && cacheable_ct;
            // classify_outcome: L1/L2 miss 이후이므로 두 플래그 모두 false
            let outcome = classify_outcome(
                true, // GET 경로에서만 이 클로저가 실행됨
                false,
                false,
                origin_no_cache,
                size_exceeded,
                origin_ok_and_cacheable,
            );

            // outcome이 Miss일 때만 optimizer → storage.put 수행
            let (serve_bytes, serve_ct) = if outcome == CacheOutcome::Miss {
                let ttl = if let CacheDirective::Cacheable(Some(t)) = cache_directive { t } else { DEFAULT_TTL };
                let full_url = format!("https://{}{}", host_c, uri_str);
                let domain = host_c.split(':').next().unwrap_or(&host_c).to_string();

                let (store_bytes, store_ct, store_br) = if should_optimize(content_type.as_deref()) {
                    // ── 이미지 최적화 분기 ──
                    if let Some(ref opt) = ps_c.optimizer {
                        let ct = content_type.clone().unwrap_or_default();
                        let started = std::time::Instant::now();
                        match opt.lock().await.optimize(resp_body.clone(), ct.clone(), &domain).await {
                            Some((ob, oct, decision, orig_sz, out_sz)) => {
                                let elapsed_ms = started.elapsed().as_millis() as u64;
                                // Phase 14: decision이 Some일 때만 image_optimize 이벤트 발행.
                                if let (Some(events), Some(dec)) = (ps_c.events.as_ref(), decision) {
                                    events.emit(crate::events::EventRecord {
                                        event_type:   "image_optimize",
                                        host:         host_c.clone(),
                                        url:          format!("https://{}{}", host_c, uri_str),
                                        decision:     dec,
                                        orig_size:    Some(orig_sz),
                                        out_size:     Some(out_sz),
                                        range_header: None,
                                        content_type: Some(oct.clone()),
                                        elapsed_ms,
                                    });
                                }
                                (ob, Some(oct), None)
                            }
                            None => (resp_body.clone(), content_type.clone(), None),
                        }
                    } else {
                        (resp_body.clone(), content_type.clone(), None)
                    }
                } else if ps_c.text_compress.enabled
                    && compress::should_compress(
                        content_type.as_deref(),
                        resp_headers.get("content-encoding").and_then(|v| v.to_str().ok()),
                        resp_body.len(),
                        ps_c.text_compress.min_bytes,
                    )
                    && resp_body.len() <= ps_c.text_compress.max_bytes
                {
                    // ── Phase 15: 텍스트 brotli 프리컴프레스 분기 ──
                    let body_clone = resp_body.clone();
                    let level = ps_c.text_compress.br_level;
                    let started = std::time::Instant::now();
                    let br_result = tokio::task::spawn_blocking(move || {
                        compress::compress_brotli(&body_clone, level)
                    }).await.unwrap_or_else(|_| Err(std::io::Error::other("spawn_blocking join 실패")));
                    let elapsed_ms = started.elapsed().as_millis() as u64;

                    let (br_opt, decision, out_size_opt) = match br_result {
                        Ok(br) if (br.len() as f32) <= (resp_body.len() as f32) * 0.9 => {
                            let out = br.len() as u64;
                            (Some(Bytes::from(br)), "compressed_br", Some(out))
                        }
                        Ok(_) => (None, "skipped_type", None),
                        Err(err) => {
                            tracing::warn!(error=%err, "brotli 압축 실패 — 원본만 저장");
                            (None, "error", None)
                        }
                    };

                    if let Some(ev) = ps_c.events.as_ref() {
                        ev.emit(crate::events::EventRecord {
                            event_type:   "text_compress",
                            host:         host_c.clone(),
                            url:          format!("https://{}{}", host_c, uri_str),
                            decision:     decision.to_string(),
                            orig_size:    Some(resp_body.len() as u64),
                            out_size:     out_size_opt,
                            range_header: None,
                            content_type: content_type.clone(),
                            elapsed_ms,
                        });
                    }

                    (resp_body.clone(), content_type.clone(), br_opt)
                } else {
                    // ── should_compress 조건 불충족 시 관찰 이벤트 발행 ──
                    if ps_c.text_compress.enabled {
                        if let Some(ev) = ps_c.events.as_ref() {
                            let ce = resp_headers.get("content-encoding").and_then(|v| v.to_str().ok());
                            let is_text = compress::is_text_content_type(content_type.as_deref());
                            let event_decision = if is_text {
                                if resp_body.len() > ps_c.text_compress.max_bytes {
                                    // DoS 가드 상한 초과
                                    Some("skipped_type")
                                } else if resp_body.len() < ps_c.text_compress.min_bytes {
                                    Some("skipped_small")
                                } else {
                                    // content-encoding 이미 존재하는 경우
                                    let ce_val = ce.unwrap_or("").trim().to_ascii_lowercase();
                                    if !ce_val.is_empty() && ce_val != "identity" {
                                        Some("skipped_type")
                                    } else {
                                        None
                                    }
                                }
                            } else {
                                None  // 이미지·오디오·비디오 등은 관찰 대상 아님
                            };
                            if let Some(dec) = event_decision {
                                ev.emit(crate::events::EventRecord {
                                    event_type:   "text_compress",
                                    host:         host_c.clone(),
                                    url:          format!("https://{}{}", host_c, uri_str),
                                    decision:     dec.to_string(),
                                    orig_size:    Some(resp_body.len() as u64),
                                    out_size:     None,
                                    range_header: None,
                                    content_type: content_type.clone(),
                                    elapsed_ms:   0,
                                });
                            }
                        }
                    }
                    (resp_body.clone(), content_type.clone(), None)
                };

                ps_c.storage.lock().await
                    .put(&key_for_put, &full_url, &host_c, store_ct.clone(), store_bytes.clone(), Some(ttl), store_br.clone())
                    .await;

                // L1 메모리 캐시 저장 (16MB 이하만)
                const MAX_MEMORY_ENTRY_BYTES: usize = 16 * 1024 * 1024;
                if store_bytes.len() <= MAX_MEMORY_ENTRY_BYTES {
                    ps_c.memory_cache.insert(key_for_put.clone(), Arc::new(MemoryCacheEntry {
                        body: Bytes::from(store_bytes.clone()),
                        content_type: store_ct.clone(),
                        body_br: store_br.clone(),
                    })).await;
                }

                (Bytes::from(store_bytes), store_ct)
            } else {
                // Bypass* — 캐시 저장 생략, 원본 응답 그대로 전달
                (resp_body, content_type)
            };

            // 첫 번째 요청자만 miss 카운터 증가 (구독자는 record_request만)
            state_c.write().await.record_cache_miss();
            Ok(Arc::new((serve_bytes, serve_ct, status, outcome)))
        }).await;

        let elapsed_ms = start.elapsed().as_millis() as u64;
        match coalesced {
            Ok(resp) => {
                let (body, ct, status, outcome) = resp.as_ref();
                let total = body.len() as u64;

                // Range 슬라이싱은 200 OK 응답에만 적용 — 오류 상태는 그대로 통과
                let (resp_status, resp_body, content_range_hdr, decision, out_bytes) =
                    if *status == StatusCode::OK {
                        match evaluate_range(&headers, total) {
                            RangeOutcome::Full => (
                                *status, body.clone(), None,
                                outcome.as_header().to_string(), total,
                            ),
                            RangeOutcome::Partial { start, end } => {
                                let sliced = body.slice(start as usize..=end as usize);
                                let len = sliced.len() as u64;
                                (
                                    StatusCode::PARTIAL_CONTENT, sliced,
                                    Some(range::format_content_range(start, end, total)),
                                    format!("{}_206", outcome.as_header()), len,
                                )
                            }
                            RangeOutcome::Invalid => (
                                StatusCode::RANGE_NOT_SATISFIABLE, Bytes::new(),
                                Some(range::format_content_range_unsatisfied(total)),
                                format!("{}_416", outcome.as_header()), 0,
                            ),
                        }
                    } else {
                        (*status, body.clone(), None, outcome.as_header().to_string(), total)
                    };

                {
                    let mut app_state = state.write().await;
                    app_state.record_request(RequestLog {
                        method: method.to_string(),
                        host: host.clone(),
                        url: uri.to_string(),
                        status_code: resp_status.as_u16(),
                        response_time_ms: elapsed_ms,
                        timestamp: chrono::Utc::now(),
                        cache_status: "MISS".to_string(),
                    });
                }
                tracing::info!(
                    method=%method, host=%host, url=%uri,
                    status=%resp_status.as_u16(), elapsed_ms=%elapsed_ms,
                    cache="MISS", "프록시 요청 처리 완료"
                );
                record_domain_outcome(&ps.counters, &host, *outcome, total, elapsed_ms);
                emit_media_cache_event(
                    &ps.events, &host, &uri, &decision,
                    Some(total), Some(out_bytes),
                    &headers, ct.as_deref(), elapsed_ms,
                );
                let mut response = Response::builder()
                    .status(resp_status)
                    .header("Accept-Ranges", "bytes");
                if let Some(ct_str) = ct {
                    response = response.header("Content-Type", ct_str.as_str());
                }
                if let Some(cr) = content_range_hdr {
                    response = response.header("Content-Range", cr);
                }
                return response
                    .header("X-Cache-Status", HeaderValue::from_static("MISS"))
                    .header("X-Cache-Reason", HeaderValue::from_static(outcome.as_header()))
                    .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
                    .body(Body::from(resp_body))
                    .unwrap();
            }
            Err(()) => {
                {
                    let mut app_state = state.write().await;
                    app_state.record_cache_bypass();
                    app_state.record_request(RequestLog {
                        method: method.to_string(),
                        host: host.clone(),
                        url: uri.to_string(),
                        status_code: 502,
                        response_time_ms: elapsed_ms,
                        timestamp: chrono::Utc::now(),
                        cache_status: "BYPASS".to_string(),
                    });
                }
                record_domain_outcome(&ps.counters, &host, CacheOutcome::BypassOther, 0, elapsed_ms);
                emit_media_cache_event(
                    &ps.events, &host, &uri, CacheOutcome::BypassOther.as_header(),
                    None, None, &headers, None, elapsed_ms,
                );
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .header("X-Cache-Status", HeaderValue::from_static("BYPASS"))
                    .header("X-Cache-Reason", HeaderValue::from_static(CacheOutcome::BypassOther.as_header()))
                    .header("X-Served-By", HeaderValue::from_static("smart-school-cdn"))
                    .body(Body::from("Origin fetch failed"))
                    .unwrap();
            }
        }
    }

    // ── non-GET: coalescer 미사용, 직접 원본 fetch ────────────────────
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let origin_url = format!("{}{}", origin, path_and_query);

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

    let response_body = match origin_response.bytes().await {
        Ok(b) => b,
        Err(err) => {
            tracing::error!(error = %err, "원본 응답 본문 읽기 실패");
            return (StatusCode::BAD_GATEWAY, "Failed to read origin response").into_response();
        }
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;

    // non-GET은 항상 BYPASS
    {
        let mut app_state = state.write().await;
        app_state.record_cache_bypass();
        app_state.record_request(RequestLog {
            method: method.to_string(),
            host: host.clone(),
            url: uri.to_string(),
            status_code: status.as_u16(),
            response_time_ms: elapsed_ms,
            timestamp: chrono::Utc::now(),
            cache_status: "BYPASS".to_string(),
        });
    }
    record_domain_outcome(&ps.counters, &host, CacheOutcome::BypassMethod, response_body.len() as u64, elapsed_ms);
    {
        // non-GET 경로는 response_headers에서 Content-Type을 추출하여 미디어 여부 판정
        let ct = response_headers
            .get("content-type")
            .and_then(|v| v.to_str().ok());
        emit_media_cache_event(
            &ps.events, &host, &uri, CacheOutcome::BypassMethod.as_header(),
            Some(response_body.len() as u64), Some(response_body.len() as u64),
            &headers, ct, elapsed_ms,
        );
    }

    tracing::info!(
        method = %method, host = %host, url = %uri,
        status = %status.as_u16(), elapsed_ms = %elapsed_ms,
        cache = "BYPASS", "프록시 요청 처리 완료"
    );

    let mut response = Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        let name = key.as_str();
        if !matches!(name, "content-type") {
            response = response.header(key, value);
        }
    }
    let final_ct = response_headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if let Some(ct) = final_ct {
        response = response.header("Content-Type", ct);
    }
    response
        .header("X-Cache-Status", HeaderValue::from_static("BYPASS"))
        .header("X-Cache-Reason", HeaderValue::from_static(CacheOutcome::BypassMethod.as_header()))
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

/// 도메인별 통계 반환 후 카운터 리셋 — Admin Server 폴링용
async fn stats_handler(State(state): State<AdminState>) -> impl IntoResponse {
    let counters = state.counters.read().unwrap();
    let stats: Vec<serde_json::Value> = counters.iter().map(|(host, c)| {
        let snap = c.take();
        let avg_rt = if snap.requests > 0 { snap.response_time_sum / snap.requests } else { 0 };
        serde_json::json!({
            "host":              host,
            "requests":          snap.requests,
            "l1_hits":           snap.l1_hits,
            "l2_hits":           snap.l2_hits,
            "cache_misses":      snap.cache_misses,
            "bypass_method":     snap.bypass_method,
            "bypass_nocache":    snap.bypass_nocache,
            "bypass_size":       snap.bypass_size,
            "bypass_other":      snap.bypass_other,
            "cache_hits":        snap.cache_hits,    // 하위 호환 (= l1_hits + l2_hits)
            "bandwidth":         snap.bandwidth,
            "avg_response_time": avg_rt
        })
    }).collect();
    Json(stats)
}

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
    let memory_hit_count = state.memory_hit_count;
    let disk_hit_count = state.disk_hit_count;
    let total = hit_count + miss_count;
    let hit_rate = if total > 0 {
        (hit_count as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let hit_rate_history: Vec<_> = state.hit_rate_history.iter().cloned().collect();
    drop(state);

    // L1 메모리 캐시 통계
    let memory_cache_entry_count = admin.memory_cache.entry_count();
    let memory_cache_max_bytes = admin.memory_cache.policy().max_capacity().unwrap_or(0);

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
        "memory_hit_count": memory_hit_count,
        "disk_hit_count": disk_hit_count,
        "memory_cache_entry_count": memory_cache_entry_count,
        "memory_cache_max_bytes": memory_cache_max_bytes,
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
    // L1 메모리 캐시 무효화
    match req.r#type.as_str() {
        "url" => {
            if let Some(ref target) = req.target {
                if !target.is_empty() {
                    if let Ok(parsed) = target.parse::<Uri>() {
                        let host = parsed.authority().map(|a| a.as_str()).unwrap_or("");
                        let path = parsed.path();
                        let query = parsed.query().unwrap_or("");
                        let key = compute_cache_key("GET", host, path, query);
                        admin.memory_cache.invalidate(&key).await;
                    }
                }
            }
        }
        "domain" | "all" => {
            admin.memory_cache.invalidate_all();
        }
        _ => {}
    }

    // L2 디스크 캐시 퍼지 (기존 로직)
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
    /// 도메인 활성화 여부 (0=비활성, 1=활성, 기본값 1)
    #[serde(default = "default_enabled")]
    enabled: i32,
}

/// enabled 필드 기본값 — 명시하지 않으면 활성 상태
fn default_enabled() -> i32 { 1 }

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
            // enabled=0인 도메인은 맵에서 제외
            if entry.enabled == 1 {
                map.insert(entry.host.clone(), entry.origin.clone());
            }
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

/// POST /domains/:host/purge — 특정 도메인의 캐시 퍼지
/// axum Path 추출기가 자동으로 URL 디코딩을 처리한다
async fn domain_purge_handler(
    State(admin): State<AdminState>,
    Path(host): Path<String>,
) -> Response {
    // L1 메모리 캐시 전체 무효화 (도메인 단위 키 분리가 없으므로 invalidate_all)
    admin.memory_cache.invalidate_all();

    // L2 디스크 캐시 — gRPC 또는 인메모리 맵에서 도메인 퍼지
    let mut storage = admin.storage.lock().await;
    let (purged_count, freed_bytes) = storage.purge_domain(&host).await;

    Json(serde_json::json!({
        "success": true,
        "host": host,
        "purged_count": purged_count,
        "freed_bytes": freed_bytes,
    })).into_response()
}

/// 요청 1건당 정확히 하나의 캐시 결과 분류.
/// 우선순위: method → L1 → L2 → NoCache → Size → Miss → Other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheOutcome {
    L1Hit,
    L2Hit,
    Miss,
    BypassMethod,
    BypassNoCache,
    BypassSize,
    BypassOther,
}

impl CacheOutcome {
    /// `X-Cache-Reason` 헤더 값
    pub fn as_header(&self) -> &'static str {
        match self {
            Self::L1Hit         => "L1-HIT",
            Self::L2Hit         => "L2-HIT",
            Self::Miss          => "MISS",
            Self::BypassMethod  => "BYPASS-METHOD",
            Self::BypassNoCache => "BYPASS-NOCACHE",
            Self::BypassSize    => "BYPASS-SIZE",
            Self::BypassOther   => "BYPASS-OTHER",
        }
    }
}

/// 순수 함수 — 입력 상태로부터 outcome을 결정한다.
/// 우선순위: method → L1 → L2 → NoCache → Size → origin_ok → Other.
/// - `method_is_get_or_head`: GET/HEAD 요청이면 true
/// - `l1_hit`: L1 메모리 캐시 HIT 여부
/// - `l2_hit`: L2 디스크 캐시 HIT 여부 (L1 miss 후에만 의미)
/// - `origin_no_cache`: origin 응답 Cache-Control이 no-cache/no-store
/// - `size_exceeded`: 응답 크기가 MAX_CACHE_ENTRY_BYTES 초과
/// - `origin_ok_and_cacheable`: origin 200 OK + 캐시 저장 성공
pub fn classify_outcome(
    method_is_get_or_head: bool,
    l1_hit: bool,
    l2_hit: bool,
    origin_no_cache: bool,
    size_exceeded: bool,
    origin_ok_and_cacheable: bool,
) -> CacheOutcome {
    if !method_is_get_or_head {
        return CacheOutcome::BypassMethod;
    }
    if l1_hit {
        return CacheOutcome::L1Hit;
    }
    if l2_hit {
        return CacheOutcome::L2Hit;
    }
    if origin_no_cache {
        return CacheOutcome::BypassNoCache;
    }
    if size_exceeded {
        return CacheOutcome::BypassSize;
    }
    if origin_ok_and_cacheable {
        return CacheOutcome::Miss;
    }
    CacheOutcome::BypassOther
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
        /// key → (body, content_type, body_br)
        data: StdMutex<HashMap<String, (Vec<u8>, String, Vec<u8>)>>,
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
                Some((body, ct, br)) => Ok(tonic::Response::new(GetResponse {
                    hit: true,
                    body: body.clone(),
                    content_type: ct.clone(),
                    body_br: br.clone(),
                })),
                None => Ok(tonic::Response::new(GetResponse {
                    hit: false,
                    body: vec![],
                    content_type: String::new(),
                    body_br: vec![],
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
                .insert(inner.key, (inner.body, inner.content_type, inner.body_br));
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
            // Phase 14: decision은 None — 패스스루 mock이라 events 발행 대상 아님
            Ok(tonic::Response::new(OptimizeResponse {
                data: inner.data,
                content_type: inner.content_type,
                original_size: size,
                optimized_size: size,
                decision: None,
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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, moka::future::Cache::builder().max_capacity(100).build(), Arc::new(std::sync::RwLock::new(HashMap::new())));

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

    /// 퍼지 type=all → memory_cache 전체 무효화
    #[tokio::test]
    async fn cache_purge_all_이_memory_cache를_무효화한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder()
                .max_capacity(100)
                .build();
        memory_cache.insert("test-key".to_string(), Arc::new(MemoryCacheEntry {
            body: Bytes::from("data"),
            content_type: Some("text/plain".to_string()),
            body_br: None,
        })).await;

        let memory_cache_check = memory_cache.clone();
        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, memory_cache, Arc::new(std::sync::RwLock::new(HashMap::new())));

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

        memory_cache_check.run_pending_tasks().await;
        assert!(
            memory_cache_check.get(&"test-key".to_string()).await.is_none(),
            "purge all 후 memory_cache 항목이 제거되어야 한다"
        );
    }

    /// /cache/stats → memory_hit_count, disk_hit_count, memory_cache_entry_count 필드 포함
    #[tokio::test]
    async fn cache_stats_handler_메모리_캐시_통계를_포함한다() {
        let (shared, storage, tls, domain_map, cert_cache) = make_test_admin_state().await;

        // 카운터 사전 설정
        {
            let mut s = shared.write().await;
            s.record_memory_hit();
            s.record_memory_hit();
            s.record_disk_hit();
        }

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder()
                .max_capacity(100)
                .build();
        memory_cache.insert("k1".to_string(), Arc::new(MemoryCacheEntry {
            body: Bytes::from("aaa"),
            content_type: None,
            body_br: None,
        })).await;
        memory_cache.insert("k2".to_string(), Arc::new(MemoryCacheEntry {
            body: Bytes::from("bbb"),
            content_type: None,
            body_br: None,
        })).await;
        // moka 비동기 캐시는 pending tasks 실행 후 entry_count 반영
        memory_cache.run_pending_tasks().await;

        let router = build_admin_router(shared, storage, tls, domain_map, cert_cache, memory_cache, Arc::new(std::sync::RwLock::new(HashMap::new())));

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
        let body = to_bytes(resp.into_body(), 8192).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // 기존 필드
        assert_eq!(json["hit_count"], 3); // memory(2) + disk(1)
        assert!(json.get("miss_count").is_some());

        // 신규 필드
        assert_eq!(json["memory_hit_count"], 2);
        assert_eq!(json["disk_hit_count"], 1);
        assert_eq!(json["memory_cache_entry_count"], 2);
        assert!(json.get("memory_cache_max_bytes").is_some());
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
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
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
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
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
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
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
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
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
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
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
    fn should_optimize_은_디코드_가능한_이미지_타입만_true를_반환한다() {
        // Phase 14: optimizer-service가 디코드 가능한 6종 + charset 파라미터 허용
        assert!(should_optimize(Some("image/jpeg")));
        assert!(should_optimize(Some("image/png")));
        assert!(should_optimize(Some("image/webp")));
        assert!(should_optimize(Some("image/gif")));
        assert!(should_optimize(Some("image/bmp")));
        assert!(should_optimize(Some("image/tiff")));
        // 디코드 미지원 포맷은 false
        assert!(!should_optimize(Some("image/avif")));
        assert!(!should_optimize(Some("image/heic")));
        assert!(!should_optimize(Some("image/svg+xml")));
        assert!(!should_optimize(Some("text/html")));
        assert!(!should_optimize(Some("application/javascript")));
        assert!(!should_optimize(None));
        // charset 파라미터가 붙어도 잘라낸 뒤 비교
        assert!(should_optimize(Some("image/jpeg; charset=utf-8")));
    }

    #[test]
    fn svg는_image_최적화가_아닌_text_압축_대상() {
        // Phase 15 회귀: SVG는 should_optimize에서 false여야 하며 텍스트 압축 대상이어야 함.
        // should_optimize에 SVG가 추가되면 텍스트 압축 경로가 깨지므로 못 박아 둔다.
        assert!(!should_optimize(Some("image/svg+xml")));
        assert!(compress::should_compress(Some("image/svg+xml"), None, 2048, 1024));
    }

    // ─── Phase 15 Unit Tests ────────────────────────────────────────────

    #[test]
    fn text_compress_event_필드_매핑이_정확하다() {
        let rec = crate::events::EventRecord {
            event_type:   "text_compress",
            host:         "a.test".into(),
            url:          "https://a.test/app.js".into(),
            decision:     "compressed_br".into(),
            orig_size:    Some(10_000),
            out_size:     Some(3_200),
            range_header: None,
            content_type: Some("application/javascript".into()),
            elapsed_ms:   12,
        };
        let json = serde_json::to_value(&rec).unwrap();
        assert_eq!(json["event_type"], "text_compress");
        assert_eq!(json["decision"], "compressed_br");
        assert_eq!(json["orig_size"], 10_000);
        assert_eq!(json["out_size"], 3_200);
        assert!(json.get("range_header").is_none());
    }

    #[test]
    fn text_compress_config_기본값() {
        // 환경변수 미설정 시 합리적 범위 확인
        let cfg = TextCompressConfig::from_env();
        assert!(cfg.br_level <= 11, "br_level 상한 11");
        assert!(cfg.gzip_level <= 9, "gzip_level 상한 9");
    }

    // ─── MISS 분기 테스트용 헬퍼 ────────────────────────────────────────

    /// 테스트용 간단한 HTTP 원본 서버 기동 — 모든 경로에 fake JPEG 응답
    async fn start_mock_origin_server(body: Vec<u8>, content_type: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let app = axum::Router::new().fallback(move || {
                let body = body.clone();
                async move {
                    axum::response::Response::builder()
                        .status(200)
                        .header("content-type", content_type)
                        .body(axum::body::Body::from(body))
                        .unwrap()
                }
            });
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    /// MISS 분기 테스트 공통 ProxyState 빌드 헬퍼
    async fn make_miss_proxy_state(
        optimizer: Option<Arc<Mutex<clients::optimizer_client::OptimizerClient>>>,
        origin_url: String,
        host: &str,
    ) -> (ProxyState, axum::Router) {
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

        let mut domain_map_inner = HashMap::new();
        domain_map_inner.insert(host.to_string(), origin_url);
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(domain_map_inner));

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer,
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };
        let router = build_proxy_router(ps.clone());
        (ps, router)
    }

    /// Mock Optimizer — 최적화 성공: OPTIMIZED_WEBP 바이트 + image/webp 반환
    #[derive(Default)]
    struct MockOptimizerSuccess;

    #[tonic::async_trait]
    impl OptimizerService for MockOptimizerSuccess {
        async fn optimize(
            &self,
            req: tonic::Request<OptimizeRequest>,
        ) -> Result<tonic::Response<OptimizeResponse>, tonic::Status> {
            let inner = req.into_inner();
            let original_size = inner.data.len() as i64;
            let optimized = b"OPTIMIZED_WEBP".to_vec();
            let optimized_size = optimized.len() as i64;
            // Phase 14: decision은 None — 테스트는 proxy 응답만 검증, events 발행 경로 확인 X
            Ok(tonic::Response::new(OptimizeResponse {
                data: optimized,
                content_type: "image/webp".to_string(),
                original_size,
                optimized_size,
                decision: None,
            }))
        }
        async fn get_profiles(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<GetProfilesResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetProfilesResponse { profiles: vec![] }))
        }
        async fn set_profile(&self, _: tonic::Request<SetProfileRequest>) -> Result<tonic::Response<OptimizerEmpty>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerEmpty {}))
        }
        async fn get_stats(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<GetStatsResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetStatsResponse { stats: vec![] }))
        }
        async fn health(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<OptimizerHealthResponse>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerHealthResponse { online: true, latency_ms: 0 }))
        }
    }

    async fn start_mock_optimizer_success_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = OptimizerServiceServer::new(MockOptimizerSuccess);
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    /// Mock Optimizer — gRPC 실패: Status::internal 반환
    #[derive(Default)]
    struct MockOptimizerFail;

    #[tonic::async_trait]
    impl OptimizerService for MockOptimizerFail {
        async fn optimize(
            &self,
            _: tonic::Request<OptimizeRequest>,
        ) -> Result<tonic::Response<OptimizeResponse>, tonic::Status> {
            Err(tonic::Status::internal("optimizer internal error"))
        }
        async fn get_profiles(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<GetProfilesResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetProfilesResponse { profiles: vec![] }))
        }
        async fn set_profile(&self, _: tonic::Request<SetProfileRequest>) -> Result<tonic::Response<OptimizerEmpty>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerEmpty {}))
        }
        async fn get_stats(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<GetStatsResponse>, tonic::Status> {
            Ok(tonic::Response::new(GetStatsResponse { stats: vec![] }))
        }
        async fn health(&self, _: tonic::Request<OptimizerEmpty>) -> Result<tonic::Response<OptimizerHealthResponse>, tonic::Status> {
            Ok(tonic::Response::new(OptimizerHealthResponse { online: true, latency_ms: 0 }))
        }
    }

    async fn start_mock_optimizer_fail_server() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let svc = OptimizerServiceServer::new(MockOptimizerFail);
        tokio::spawn(async move {
            tonic::transport::Server::builder()
                .add_service(svc)
                .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener))
                .await
                .unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    // ─── Phase 15 HIT 통합 테스트 ───────────────────────────────────────

    /// Phase 15 Task 13: HIT 시 br Accept-Encoding 요청 → br 변형 응답
    #[tokio::test]
    async fn phase15_hit_accept_encoding_br_시_br_변형을_응답한다() {
        let html = "<!DOCTYPE html>".to_string() + &"<p>x</p>".repeat(500);
        let origin_url = start_mock_origin_server(html.as_bytes().to_vec(), "text/html").await;

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

        let mut dm = HashMap::new();
        dm.insert("hit-br.local".to_string(), origin_url);
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage_client)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: None,
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: memory_cache.clone(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        // 1차 요청: MISS — brotli 저장
        let router = build_proxy_router(ps.clone());
        let resp1 = router
            .oneshot(
                Request::builder()
                    .uri("/a.html")
                    .header("host", "hit-br.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp1.status(), StatusCode::OK);
        drop(to_bytes(resp1.into_body(), 1024 * 1024).await.unwrap());

        // moka 비동기 캐시는 pending tasks 완료 후 항목 조회 가능
        memory_cache.run_pending_tasks().await;

        // 2차 요청: HIT with br
        let router2 = build_proxy_router(ps.clone());
        let resp2 = router2
            .oneshot(
                Request::builder()
                    .uri("/a.html")
                    .header("host", "hit-br.local")
                    .header("accept-encoding", "br, gzip")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp2.status(), StatusCode::OK);
        assert_eq!(
            resp2.headers().get("content-encoding").and_then(|v| v.to_str().ok()),
            Some("br"),
            "br Accept-Encoding 시 content-encoding: br 이어야 한다"
        );
        assert!(resp2.headers().get("vary").is_some(), "Vary 헤더가 있어야 한다");
        // 회귀 방지: Content-Length를 수동 설정했을 때 원본 크기로 나가 브라우저가 pending 상태에 빠진 사례가 있다.
        // GET+br 응답의 Content-Length 헤더는 axum이 body.len()에서 자동 산출하므로 반드시 압축본 크기와 일치해야 한다.
        let cl_header = resp2
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok());
        let body = to_bytes(resp2.into_body(), 1024 * 1024).await.unwrap();
        assert!(body.len() < html.len() / 2, "br 압축 응답은 원본보다 작아야 한다: {} vs {}", body.len(), html.len());
        if let Some(cl) = cl_header {
            assert_eq!(cl, body.len(), "GET+br 응답의 Content-Length는 압축본 body 크기와 일치해야 한다 (원본 {})", html.len());
        }
    }

    /// Phase 15 Task 13: HIT 시 Accept-Encoding 없으면 identity 응답
    #[tokio::test]
    async fn phase15_hit_accept_encoding_없으면_원본_identity_응답() {
        let html = "<!DOCTYPE html>".to_string() + &"<p>x</p>".repeat(500);
        let origin_url = start_mock_origin_server(html.as_bytes().to_vec(), "text/html").await;

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

        let mut dm = HashMap::new();
        dm.insert("hit-identity.local".to_string(), origin_url);
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage_client)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: None,
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: memory_cache.clone(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        // 1차 MISS
        let router = build_proxy_router(ps.clone());
        let resp1 = router
            .oneshot(
                Request::builder()
                    .uri("/b.html")
                    .header("host", "hit-identity.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp1.status(), StatusCode::OK);
        drop(to_bytes(resp1.into_body(), 1024 * 1024).await.unwrap());

        memory_cache.run_pending_tasks().await;

        // 2차 HIT without Accept-Encoding
        let router2 = build_proxy_router(ps.clone());
        let resp2 = router2
            .oneshot(
                Request::builder()
                    .uri("/b.html")
                    .header("host", "hit-identity.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp2.status(), StatusCode::OK);
        assert!(
            resp2.headers().get("content-encoding").is_none(),
            "Accept-Encoding 없으면 content-encoding 헤더가 없어야 한다"
        );
        let body = to_bytes(resp2.into_body(), 1024 * 1024).await.unwrap();
        assert_eq!(body.len(), html.len(), "identity 응답은 원본 크기와 같아야 한다");
    }

    // ─── Phase 15 MISS 통합 테스트 ──────────────────────────────────────

    /// Phase 15 Task 12: MISS 시 text/html 응답에 brotli 변형이 함께 저장된다
    #[tokio::test]
    async fn phase15_miss_시_텍스트_응답은_brotli_변형이_함께_저장된다() {
        let html = "<!DOCTYPE html>\n<html><body>".to_string()
            + &"<p>textbook content</p>\n".repeat(500)
            + "</body></html>";
        let origin_url = start_mock_origin_server(html.as_bytes().to_vec(), "text/html; charset=utf-8").await;

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

        let mut dm = HashMap::new();
        dm.insert("textbook.local".to_string(), origin_url);
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        // TextCompressConfig.br_level=6 (테스트 속도 우선)
        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage_client.clone())),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: None,
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache: moka::future::Cache::builder().max_capacity(100).build(),
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/page.html")
                    .header("host", "textbook.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        drop(to_bytes(resp.into_body(), 1024 * 1024).await.unwrap());

        // storage에 저장된 body_br 확인
        let key = compute_cache_key("GET", "textbook.local", "/page.html", "");
        let stored = storage_client.clone().get(&key).await;
        let (_, _, body_br) = stored.expect("storage에 항목이 저장돼야 한다");
        assert!(body_br.is_some(), "brotli 변형이 함께 저장돼야 한다");
        let br = body_br.unwrap();
        assert!(br.len() < html.len() / 2, "br 크기 < 원본/2: {} vs {}", br.len(), html.len());
    }

    // ─── MISS 분기 테스트 A·B·C ─────────────────────────────────────────

    /// Test A: MISS → optimizer 성공 → 최적화된 본문·content-type 응답
    #[tokio::test]
    async fn proxy_handler_miss_optimizer_성공시_최적화된_응답을_반환한다() {
        let fake_jpeg = b"\xff\xd8\xff\xe0fake_jpeg_data".to_vec();
        let origin_url = start_mock_origin_server(fake_jpeg, "image/jpeg").await;

        let opt_url = start_mock_optimizer_success_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&opt_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };

        let (_, router) = make_miss_proxy_state(
            Some(Arc::new(Mutex::new(optimizer))),
            origin_url,
            "miss-opt-success.test.com",
        ).await;

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/img.jpg")
                    .header("host", "miss-opt-success.test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        // optimizer가 반환한 content-type
        assert_eq!(resp.headers().get("content-type").unwrap(), "image/webp");
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        assert_eq!(body.as_ref(), b"OPTIMIZED_WEBP");
    }

    /// Test B: MISS → optimizer gRPC 실패 → 원본 본문·content-type으로 그레이스풀 디그레이드
    #[tokio::test]
    async fn proxy_handler_miss_optimizer_실패시_원본_응답으로_폴백한다() {
        let fake_jpeg = b"\xff\xd8\xff\xe0fake_jpeg_data".to_vec();
        let origin_url = start_mock_origin_server(fake_jpeg.clone(), "image/jpeg").await;

        let opt_url = start_mock_optimizer_fail_server().await;
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&opt_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };

        let (_, router) = make_miss_proxy_state(
            Some(Arc::new(Mutex::new(optimizer))),
            origin_url,
            "miss-opt-fail.test.com",
        ).await;

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/img.jpg")
                    .header("host", "miss-opt-fail.test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // 500이 아닌 200, 원본 content-type
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("content-type").unwrap(), "image/jpeg");
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        assert_eq!(body.as_ref(), fake_jpeg.as_slice());
    }

    /// Test C: MISS → optimizer=None → 원본 본문 정상 반환 (패닉 없음)
    #[tokio::test]
    async fn proxy_handler_miss_optimizer_없으면_원본_응답을_반환한다() {
        let fake_jpeg = b"\xff\xd8\xff\xe0fake_jpeg_data".to_vec();
        let origin_url = start_mock_origin_server(fake_jpeg.clone(), "image/jpeg").await;

        let (_, router) = make_miss_proxy_state(
            None, // optimizer 없음
            origin_url,
            "miss-no-opt.test.com",
        ).await;

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/img.jpg")
                    .header("host", "miss-no-opt.test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("content-type").unwrap(), "image/jpeg");
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        assert_eq!(body.as_ref(), fake_jpeg.as_slice());
    }

    /// L1 메모리 캐시 HIT → gRPC storage 호출 없이 200 반환 + memory_hit_count 증가
    #[tokio::test]
    async fn memory_cache_hit_이_gRPC_호출_없이_반환한다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;
        let optimizer_url = start_mock_optimizer_server().await;

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
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let mut dm = HashMap::new();
        dm.insert("test.com".to_string(), "http://origin.test.com".to_string());
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();
        let key = compute_cache_key("GET", "test.com", "/hello", "");
        memory_cache.insert(key, Arc::new(MemoryCacheEntry {
            body: Bytes::from("cached-in-memory"),
            content_type: Some("text/plain".to_string()),
            body_br: None,
        })).await;

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache,
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        let shared = ps.shared.clone();
        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/hello")
                    .header("host", "test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("X-Cache-Status").unwrap(), "HIT");
        let body = to_bytes(resp.into_body(), 4096).await.unwrap();
        assert_eq!(&body[..], b"cached-in-memory");

        let app_state = shared.read().await;
        assert_eq!(app_state.memory_hit_count, 1);
        assert_eq!(app_state.disk_hit_count, 0);
    }

    /// L2 디스크 HIT → L1 메모리 캐시에 승격 + disk_hit_count 증가
    #[tokio::test]
    async fn disk_hit_이_memory_cache로_승격된다() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;
        let optimizer_url = start_mock_optimizer_server().await;

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
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();
        let mut dm = HashMap::new();
        dm.insert("test.com".to_string(), "http://origin.test.com".to_string());
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let key = compute_cache_key("GET", "test.com", "/disk-item", "");
        {
            let mut s = loop {
                match clients::storage_client::StorageClient::connect(&storage_url).await {
                    Ok(c) => break c,
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
                }
            };
            s.put(&key, "https://test.com/disk-item", "test.com", Some("text/html".to_string()), vec![60, 104, 49, 62].into(), Some(std::time::Duration::from_secs(3600)), None).await;
        }

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();
        let memory_cache_check = memory_cache.clone();

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage_client)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache,
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        let shared = ps.shared.clone();
        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/disk-item")
                    .header("host", "test.com")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers().get("X-Cache-Status").unwrap(), "HIT");

        let app_state = shared.read().await;
        assert_eq!(app_state.disk_hit_count, 1);
        assert_eq!(app_state.memory_hit_count, 0);
        drop(app_state);

        let entry = memory_cache_check.get(&key).await;
        assert!(entry.is_some(), "L2 HIT 후 L1 메모리 캐시에 승격되어야 한다");
        assert_eq!(&entry.unwrap().body[..], &[60, 104, 49, 62]);
    }

    // ─── is_cacheable_content_type 단위 테스트 ───────────────────────

    // ─── is_media_request 단위 테스트 ───────────────────────────────────

    #[test]
    fn is_media_request_video_audio_extensions() {
        // 비디오
        assert!(is_media_request("/foo/p34.mp4", None));
        assert!(is_media_request("/x/y/trailer.m4v", None));
        assert!(is_media_request("/clip.webm", None));
        // 오디오
        assert!(is_media_request("/media/mp3/page-flip.mp3", None));
        assert!(is_media_request("/clip.m4a", None));
        assert!(is_media_request("/beep.wav", None));
    }

    #[test]
    fn is_media_request_respects_content_type_when_extension_missing() {
        // 확장자 없는 path라도 Content-Type으로 판정
        assert!(is_media_request("/stream/abc", Some("video/mp4")));
        assert!(is_media_request("/stream/def", Some("audio/mpeg; charset=binary")));
    }

    #[test]
    fn is_media_request_rejects_non_media() {
        // 이미지·텍스트 자산은 Phase 13 범위 밖
        assert!(!is_media_request("/icon.png", None));
        assert!(!is_media_request("/script.js", Some("application/javascript")));
        assert!(!is_media_request("/page.xhtml", Some("text/html")));
        assert!(!is_media_request("/font.woff2", None));
        // 확장자 없음 + content-type 없음
        assert!(!is_media_request("/api/annotation", None));
    }

    #[test]
    fn is_media_request_handles_query_and_fragment() {
        // 확장자 뒤 쿼리/프래그먼트가 붙어도 정상 판정
        assert!(is_media_request("/p34.mp4?token=abc", None));
        assert!(is_media_request("/p34.mp4#t=10", None));
    }

    // ─── is_static_extension 단위 테스트 ────────────────────────────────

    #[test]
    fn is_static_extension_recognizes_media() {
        assert!(is_static_extension("/foo/p34.mp4"));
        assert!(is_static_extension("/sound/bell.mp3"));
        assert!(is_static_extension("/x/clip.webm"));
    }

    #[test]
    fn is_static_extension_recognizes_images_fonts_scripts() {
        assert!(is_static_extension("/a/b.png"));
        assert!(is_static_extension("/a/b.jpg"));
        assert!(is_static_extension("/a/b.webp"));
        assert!(is_static_extension("/fonts/Nanum.woff2"));
        assert!(is_static_extension("/scripts/main.js"));
        assert!(is_static_extension("/styles/app.css"));
        assert!(is_static_extension("/wasm/pkg.wasm"));
    }

    #[test]
    fn is_static_extension_rejects_api_and_extensionless() {
        assert!(!is_static_extension("/api/annotation"));
        assert!(!is_static_extension("/api/something.json")); // json은 화이트리스트 밖
        assert!(!is_static_extension("/dynamic/thing"));
        assert!(!is_static_extension("/"));
        assert!(!is_static_extension(""));
    }

    #[test]
    fn is_static_extension_handles_query_and_fragment() {
        assert!(is_static_extension("/p34.mp4?token=abc"));
        assert!(is_static_extension("/style.css#x"));
    }

    // ─── evaluate_range 단위 테스트 ────────────────────────────────────
    // (실제 proxy 핸들러가 의존하는 통합 동작 — HeaderMap + total_size 기반)

    fn headers_with_range(value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(axum::http::header::RANGE, HeaderValue::from_str(value).unwrap());
        h
    }

    #[test]
    fn evaluate_range_no_header_returns_full() {
        let h = HeaderMap::new();
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Full);
    }

    #[test]
    fn evaluate_range_parse_failure_falls_back_to_full() {
        // multi-range는 파싱 실패 → RFC 권고대로 Full (200 응답)
        let h = headers_with_range("bytes=0-99,200-299");
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Full);

        // 비표준 단위도 Full
        let h = headers_with_range("pages=1-2");
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Full);
    }

    #[test]
    fn evaluate_range_bounded_in_total_returns_partial() {
        let h = headers_with_range("bytes=0-99");
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Partial { start: 0, end: 99 });
    }

    #[test]
    fn evaluate_range_start_beyond_total_returns_invalid() {
        let h = headers_with_range("bytes=5000-5099");
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Invalid);
    }

    #[test]
    fn evaluate_range_suffix_within_total_returns_partial() {
        let h = headers_with_range("bytes=-200");
        assert_eq!(evaluate_range(&h, 1000), RangeOutcome::Partial { start: 800, end: 999 });
    }

    #[test]
    fn is_cacheable_content_type_checks() {
        assert!(is_cacheable_content_type("image/png"));
        assert!(is_cacheable_content_type("image/svg+xml"));
        assert!(is_cacheable_content_type("text/html"));
        assert!(is_cacheable_content_type("text/css"));
        assert!(is_cacheable_content_type("font/woff2"));
        assert!(is_cacheable_content_type("video/mp4"));
        assert!(is_cacheable_content_type("audio/mpeg"));
        assert!(is_cacheable_content_type("application/javascript"));
        assert!(is_cacheable_content_type("application/json"));
        assert!(is_cacheable_content_type("application/pdf"));
        assert!(is_cacheable_content_type("application/wasm"));
        assert!(is_cacheable_content_type("application/epub+zip"));
        assert!(is_cacheable_content_type("application/octet-stream"));

        // 비캐시 대상
        assert!(!is_cacheable_content_type(""));
        assert!(!is_cacheable_content_type("application/xml"));
        assert!(!is_cacheable_content_type("multipart/form-data"));
    }

    // ─── CacheOutcome / classify_outcome 단위 테스트 ──────────────────

    #[test]
    fn classify_outcome_비GET은_method_bypass() {
        assert_eq!(
            classify_outcome(false, false, false, false, false, false),
            CacheOutcome::BypassMethod
        );
    }

    #[test]
    fn classify_outcome_l1_히트() {
        assert_eq!(
            classify_outcome(true, true, false, false, false, false),
            CacheOutcome::L1Hit
        );
    }

    #[test]
    fn classify_outcome_l1_미스_l2_히트() {
        assert_eq!(
            classify_outcome(true, false, true, false, false, false),
            CacheOutcome::L2Hit
        );
    }

    #[test]
    fn classify_outcome_origin_nocache() {
        assert_eq!(
            classify_outcome(true, false, false, true, false, false),
            CacheOutcome::BypassNoCache
        );
    }

    #[test]
    fn classify_outcome_size_초과() {
        assert_eq!(
            classify_outcome(true, false, false, false, true, false),
            CacheOutcome::BypassSize
        );
    }

    #[test]
    fn classify_outcome_origin_ok_캐시_저장() {
        assert_eq!(
            classify_outcome(true, false, false, false, false, true),
            CacheOutcome::Miss
        );
    }

    #[test]
    fn classify_outcome_기타는_other() {
        assert_eq!(
            classify_outcome(true, false, false, false, false, false),
            CacheOutcome::BypassOther
        );
    }

    #[test]
    fn classify_outcome_nocache가_size보다_우선() {
        assert_eq!(
            classify_outcome(true, false, false, true, true, false),
            CacheOutcome::BypassNoCache
        );
    }

    #[test]
    fn cache_outcome_as_header_매핑() {
        assert_eq!(CacheOutcome::L1Hit.as_header(),         "L1-HIT");
        assert_eq!(CacheOutcome::L2Hit.as_header(),         "L2-HIT");
        assert_eq!(CacheOutcome::Miss.as_header(),          "MISS");
        assert_eq!(CacheOutcome::BypassMethod.as_header(),  "BYPASS-METHOD");
        assert_eq!(CacheOutcome::BypassNoCache.as_header(), "BYPASS-NOCACHE");
        assert_eq!(CacheOutcome::BypassSize.as_header(),    "BYPASS-SIZE");
        assert_eq!(CacheOutcome::BypassOther.as_header(),   "BYPASS-OTHER");
    }

    // ─── outcome 분류·X-Cache-Reason 헤더 통합 테스트 ────────────────────

    /// Cache-Control: no-store 헤더를 포함하는 mock 원본 서버 기동
    /// — origin_no_cache 분기(BYPASS-NOCACHE) 검증용
    async fn start_mock_origin_server_with_nostore(body: Vec<u8>, content_type: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let app = axum::Router::new().fallback(move || {
                let body = body.clone();
                async move {
                    axum::response::Response::builder()
                        .status(200)
                        .header("content-type", content_type)
                        .header("cache-control", "no-store")
                        .body(axum::body::Body::from(body))
                        .unwrap()
                }
            });
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    /// POST 요청은 non-GET 경로로 처리되어 BYPASS-METHOD로 분류되고
    /// X-Cache-Reason: BYPASS-METHOD 헤더가 반환된다
    #[tokio::test]
    async fn post_요청은_bypass_method로_분류되고_x_cache_reason_헤더_포함() {
        let origin_url = start_mock_origin_server(b"hello".to_vec(), "text/plain").await;
        let (ps, router) = make_miss_proxy_state(None, origin_url, "post-test.local").await;

        let resp = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/")
                    .header("host", "post-test.local")
                    .body(axum::body::Body::from("body"))
                    .unwrap(),
            )
            .await
            .unwrap();

        // POST 자체는 origin에서 200을 받아 그대로 전달
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("x-cache-reason").and_then(|v| v.to_str().ok()),
            Some("BYPASS-METHOD")
        );
        assert_eq!(
            resp.headers().get("x-cache-status").and_then(|v| v.to_str().ok()),
            Some("BYPASS")
        );

        // bypass_method 카운터만 1 증가, 다른 캐시 카운터는 0
        let map = ps.counters.read().unwrap();
        let c = map.get("post-test.local").expect("카운터 항목 없음");
        assert_eq!(c.bypass_method.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(c.l1_hits.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(c.l2_hits.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(c.cache_misses.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(c.bypass_nocache.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    /// L1 메모리 캐시 HIT → X-Cache-Reason: L1-HIT 헤더 반환 + l1_hits 카운터 증가
    #[tokio::test]
    async fn l1_hit_응답은_x_cache_reason_l1_hit_헤더_포함하고_l1_hits_증가() {
        let storage_url = start_mock_storage_server().await;
        let tls_url = start_mock_tls_server().await;
        let optimizer_url = start_mock_optimizer_server().await;

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
        let optimizer = loop {
            match clients::optimizer_client::OptimizerClient::connect(&optimizer_url).await {
                Ok(c) => break c,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        };
        let cert_cache = tls.cert_cache.clone();

        let mut dm = HashMap::new();
        dm.insert("l1hit.local".to_string(), "http://origin.l1hit.local".to_string());
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();

        // L1 캐시에 항목 미리 삽입
        let key = compute_cache_key("GET", "l1hit.local", "/page", "");
        memory_cache.insert(key, Arc::new(MemoryCacheEntry {
            body: Bytes::from("l1-cached-body"),
            content_type: Some("text/html".to_string()),
            body_br: None,
        })).await;

        let ps = ProxyState {
            shared: Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client: reqwest::Client::new(),
            storage: Arc::new(Mutex::new(storage)),
            tls_client: Arc::new(Mutex::new(tls)),
            optimizer: Some(Arc::new(Mutex::new(optimizer))),
            domain_map,
            cert_cache,
            coalescer: Arc::new(coalescer::Coalescer::new()),
            memory_cache,
            counters: Arc::new(std::sync::RwLock::new(HashMap::new())),
            events: None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        let router = build_proxy_router(ps.clone());
        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/page")
                    .header("host", "l1hit.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("x-cache-reason").and_then(|v| v.to_str().ok()),
            Some("L1-HIT")
        );
        assert_eq!(
            resp.headers().get("x-cache-status").and_then(|v| v.to_str().ok()),
            Some("HIT")
        );

        // l1_hits만 증가, miss/bypass는 0
        let map = ps.counters.read().unwrap();
        let c = map.get("l1hit.local").expect("카운터 항목 없음");
        assert_eq!(c.l1_hits.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(c.cache_misses.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(c.bypass_method.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    /// Phase 15: HEAD 요청은 body 없이 원본 크기 Content-Length를 반환해야 한다 (RFC 7231 §4.3.2)
    #[tokio::test]
    async fn phase15_head_요청은_body_없이_원본_크기_content_length() {
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

        let mut dm = HashMap::new();
        dm.insert("head.local".to_string(), "http://origin.head.local".to_string());
        let domain_map: DomainMap = Arc::new(tokio::sync::RwLock::new(dm));

        let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
            moka::future::Cache::builder().max_capacity(100).build();

        let cached_body = b"Hello, HEAD World!".to_vec();
        let orig_len = cached_body.len();
        // GET 캐시 키로 L1에 삽입 (HEAD는 GET과 같은 키를 공유)
        let key = compute_cache_key("GET", "head.local", "/page", "");
        memory_cache.insert(key, Arc::new(MemoryCacheEntry {
            body:         Bytes::from(cached_body),
            content_type: Some("text/html".to_string()),
            body_br:      None,
        })).await;

        let ps = ProxyState {
            shared:       Arc::new(tokio::sync::RwLock::new(state::AppState::new())),
            http_client:  reqwest::Client::new(),
            storage:      Arc::new(Mutex::new(storage)),
            tls_client:   Arc::new(Mutex::new(tls)),
            optimizer:    None,
            domain_map,
            cert_cache,
            coalescer:    Arc::new(coalescer::Coalescer::new()),
            memory_cache,
            counters:     Arc::new(std::sync::RwLock::new(HashMap::new())),
            events:       None,
            text_compress: TextCompressConfig { enabled: true, min_bytes: 1024, br_level: 6, gzip_level: 6, max_bytes: 8_388_608 },
        };

        let router = build_proxy_router(ps);
        let resp = router
            .oneshot(
                Request::builder()
                    .method(Method::HEAD)
                    .uri("/page")
                    .header("host", "head.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        // Content-Length는 원본 body 크기와 일치해야 한다
        let cl = resp.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .expect("Content-Length 헤더 없음");
        assert_eq!(cl, orig_len, "HEAD Content-Length은 원본 body 크기여야 한다");
        // body는 비어 있어야 한다
        let body_bytes = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        assert!(body_bytes.is_empty(), "HEAD 응답 body는 비어야 한다");
    }

    /// origin이 Cache-Control: no-store를 반환하면 BYPASS-NOCACHE로 분류되고
    /// storage.put()이 호출되지 않는다 (gRPC mock storage에 항목이 없음)
    #[tokio::test]
    async fn origin_no_store_응답은_bypass_nocache_로_분류되고_저장_안됨() {
        let origin_url = start_mock_origin_server_with_nostore(
            b"<html>no-store</html>".to_vec(),
            "text/html",
        ).await;

        let (ps, router) = make_miss_proxy_state(None, origin_url, "nostore.local").await;

        let resp = router
            .oneshot(
                Request::builder()
                    .uri("/page")
                    .header("host", "nostore.local")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("x-cache-reason").and_then(|v| v.to_str().ok()),
            Some("BYPASS-NOCACHE")
        );

        // bypass_nocache 카운터만 증가, miss는 0
        let map = ps.counters.read().unwrap();
        let c = map.get("nostore.local").expect("카운터 항목 없음");
        assert_eq!(c.bypass_nocache.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(c.cache_misses.load(std::sync::atomic::Ordering::Relaxed), 0);

        // storage에 항목이 없어야 함 — gRPC get으로 확인
        // (coalescer 내부에서 put이 호출됐다면 storage에 키가 존재했을 것)
        let key = compute_cache_key("GET", "nostore.local", "/page", "");
        let hit = ps.storage.lock().await.get(&key).await;
        assert!(hit.is_none(), "no-store 응답은 storage에 저장되지 않아야 한다");
    }

    // ─── classify_outcome 사이즈 우선순위 단위 테스트 ────────────────────

    /// size_exceeded=true이면 다른 조건과 무관하게 BypassSize 반환
    #[test]
    fn classify_outcome_size_exceeded_는_bypass_size() {
        assert_eq!(
            classify_outcome(true, false, false, false, true, false),
            CacheOutcome::BypassSize,
        );
    }

    /// size_exceeded가 true이고 origin_ok_and_cacheable도 true여도 BypassSize가 우선
    #[test]
    fn classify_outcome_size가_cacheable보다_우선() {
        assert_eq!(
            classify_outcome(true, false, false, false, true, true),
            CacheOutcome::BypassSize,
        );
    }
}
