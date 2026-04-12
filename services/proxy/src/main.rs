/// Smart School CDN Proxy Service
/// HTTP 리버스 프록시(8080) + HTTPS 443 + 관리 API(8081)를 동시에 실행한다.
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

use rustls::ServerConfig;
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use axum_server::tls_rustls::RustlsConfig;

use std::collections::HashMap;

use proxy::cache::CacheLayer;
use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::tls::TlsManager;
use proxy::{DomainMap, build_admin_router, build_proxy_router, ProxyState};

/// rustls SNI 핸들러 — 클라이언트의 서버명에 맞는 인증서를 TlsManager에서 조회·발급
struct SniCertResolver {
    tls_manager: Arc<TlsManager>,
}

impl std::fmt::Debug for SniCertResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SniCertResolver").finish()
    }
}

impl ResolvesServerCert for SniCertResolver {
    fn resolve(&self, client_hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        let domain = client_hello.server_name()?;
        let cached = self.tls_manager.get_or_issue(domain)?;
        Some(cached.certified_key.clone())
    }
}

#[tokio::main]
async fn main() {
    // ring CryptoProvider 명시적 등록 (rustls 0.23 필수)
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("ring CryptoProvider 설치 실패");

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let proxy_config = Arc::new(ProxyConfig::default_config());
    let http_client = reqwest::Client::new();

    // 도메인 맵 초기화 — Admin Server가 시작 시 push로 갱신한다
    let domain_map: DomainMap = Arc::new(RwLock::new({
        let mut m = HashMap::new();
        // 개발/테스트용 기본값: Admin Server push 전까지 사용
        m.insert("httpbin.org".to_string(), "https://httpbin.org".to_string());
        m
    }));

    // 캐시 레이어 생성 — 기본 20GB, 캐시 디렉토리 ./cache/
    let cache_dir = PathBuf::from(
        std::env::var("CACHE_DIR").unwrap_or_else(|_| "./cache".to_string()),
    );
    let max_size_bytes: u64 = std::env::var("CACHE_MAX_SIZE_GB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(20)
        * 1024
        * 1024
        * 1024;
    let cache = Arc::new(CacheLayer::new(cache_dir, max_size_bytes));

    // TLS 관리자 생성 — CA 인증서 로드 또는 신규 생성
    let certs_dir = std::path::PathBuf::from(
        std::env::var("CERTS_DIR").unwrap_or_else(|_| "./certs".to_string()),
    );
    let tls_manager = TlsManager::load_or_create(&certs_dir)
        .expect("TLS 관리자 초기화 실패");

    // 매분 히트율 스냅샷 기록 배경 태스크
    let state_for_snapshot = shared_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            state_for_snapshot.write().await.record_hit_rate_snapshot();
        }
    });

    let ps = ProxyState {
        shared: shared_state.clone(),
        config: proxy_config,
        http_client,
        cache: cache.clone(),
        tls_manager: tls_manager.clone(),
        domain_map: domain_map.clone(),
    };
    let proxy_router = build_proxy_router(ps);
    let admin_router = build_admin_router(shared_state.clone(), cache, tls_manager.clone(), domain_map.clone());

    // rustls ServerConfig — SNI 기반 인증서 선택
    let server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(SniCertResolver {
            tls_manager: tls_manager.clone(),
        }));
    let rustls_config = RustlsConfig::from_config(Arc::new(server_config));

    tracing::info!("Proxy Service 시작 — HTTP :8080, HTTPS :443, Admin :8081");

    // HTTPS 프록시 서버 (443) — proxy_router clone은 move 전에 수행
    let https_router = proxy_router.clone();

    let proxy_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
        axum::serve(listener, proxy_router).await.unwrap();
    });
    let https_server = tokio::spawn(async move {
        axum_server::bind_rustls("0.0.0.0:443".parse().unwrap(), rustls_config)
            .serve(https_router.into_make_service())
            .await
            .unwrap();
    });

    let admin_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();
        axum::serve(listener, admin_router).await.unwrap();
    });

    tokio::select! {
        _ = proxy_server => tracing::error!("HTTP 프록시 서버 종료"),
        _ = https_server => tracing::error!("HTTPS 프록시 서버 종료"),
        _ = admin_server => tracing::error!("Admin API 서버 종료"),
        _ = tokio::signal::ctrl_c() => tracing::info!("종료 신호 수신"),
    }
}
