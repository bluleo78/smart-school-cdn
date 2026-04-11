/// Smart School CDN Proxy Service
/// HTTP 리버스 프록시(8080) + 관리 API(8081)를 동시에 실행한다.
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

use proxy::cache::CacheLayer;
use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::tls::TlsManager;
use proxy::{build_admin_router, build_proxy_router, ProxyState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let proxy_config = Arc::new(ProxyConfig::default_config());
    let http_client = reqwest::Client::new();

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
    };
    let proxy_router = build_proxy_router(ps);
    let admin_router = build_admin_router(shared_state.clone(), cache, tls_manager);

    tracing::info!("Proxy Service started — proxy :8080, admin :8081");

    let proxy_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
        axum::serve(listener, proxy_router).await.unwrap();
    });

    let admin_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();
        axum::serve(listener, admin_router).await.unwrap();
    });

    tokio::select! {
        _ = proxy_server => tracing::error!("Proxy server exited"),
        _ = admin_server => tracing::error!("Admin API server exited"),
        _ = tokio::signal::ctrl_c() => tracing::info!("Shutting down"),
    }
}
