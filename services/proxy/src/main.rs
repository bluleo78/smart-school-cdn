/// Smart School CDN Proxy Service
/// HTTP 리버스 프록시(8080) + 관리 API(8081)를 동시에 실행한다.
/// - 프록시: Host 헤더 기반으로 원본 서버에 요청을 중계
/// - 관리 API: Admin Server가 프록시 상태/요청 로그를 조회할 때 사용
use std::sync::Arc;

use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::{build_admin_router, build_proxy_router};

#[tokio::main]
async fn main() {
    // 로깅 초기화
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    // 공유 상태 + 설정 생성
    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let proxy_config = Arc::new(ProxyConfig::default_config());
    let http_client = reqwest::Client::new();

    // 프록시 / 관리 API 라우터 구성 (라이브러리 모듈에서 재사용)
    let proxy_router = build_proxy_router(shared_state.clone(), proxy_config, http_client);
    let admin_router = build_admin_router(shared_state.clone());

    tracing::info!("Proxy Service started — proxy :8080, admin :8081");

    // 두 서버를 동시에 실행
    let proxy_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
        axum::serve(listener, proxy_router).await.unwrap();
    });

    let admin_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();
        axum::serve(listener, admin_router).await.unwrap();
    });

    // 둘 중 하나라도 종료되면 전체 종료
    tokio::select! {
        _ = proxy_server => tracing::error!("Proxy server exited"),
        _ = admin_server => tracing::error!("Admin API server exited"),
        _ = tokio::signal::ctrl_c() => tracing::info!("Shutting down"),
    }
}
