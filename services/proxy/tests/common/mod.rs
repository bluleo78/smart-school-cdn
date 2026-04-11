/// 통합 테스트 공용 헬퍼
/// - mock 원본 서버 + proxy 라우터 + admin 라우터를 임의 포트에 띄워서
///   end-to-end 호출이 가능한 TestEnv를 반환한다.
/// - tests/ 하위의 각 통합 테스트 파일이 `mod common;`으로 가져다 쓴다.
use std::collections::HashMap;
use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use proxy::cache::CacheLayer;
use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::{build_admin_router, build_proxy_router};
use tokio::sync::RwLock;

/// 한 번의 테스트에 필요한 엔드포인트 주소 묶음
pub struct TestEnv {
    pub proxy_addr: String,
    pub admin_addr: String,
    pub mock_origin_host: String,
}

/// 테스트 환경 부트스트랩
/// 1. mock 원본 서버를 임의 포트에 바인드 (GET /hello → "Hello from origin")
/// 2. proxy_config에 "test.local" → mock origin URL 매핑 등록
/// 3. proxy 라우터 / admin 라우터를 각각 임의 포트에 바인드
pub async fn setup_env() -> TestEnv {
    // 1. mock 원본 서버
    let origin_router = Router::new().route("/hello", get(|| async { "Hello from origin" }));
    let origin_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin_port = origin_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(origin_listener, origin_router).await.unwrap();
    });

    // 2. proxy 설정 — "test.local"을 mock origin으로 라우팅
    let mock_origin_url = format!("http://127.0.0.1:{origin_port}");
    let mut domains = HashMap::new();
    domains.insert("test.local".to_string(), mock_origin_url);
    let proxy_config = Arc::new(ProxyConfig::with_domains(domains));

    // 3. 공유 상태 + HTTP 클라이언트 + CacheLayer
    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let http_client = reqwest::Client::new();
    let cache = Arc::new(CacheLayer::new(std::path::PathBuf::from("/tmp/test-cache"), 64 * 1024 * 1024));

    // 4. 프록시 라우터 → 임의 포트 바인드
    let proxy_router = build_proxy_router(shared_state.clone(), proxy_config, http_client, cache.clone());
    let proxy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = proxy_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(proxy_listener, proxy_router).await.unwrap();
    });

    // 5. 관리 API 라우터 → 임의 포트 바인드
    let admin_router = build_admin_router(shared_state.clone(), cache);
    let admin_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let admin_port = admin_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(admin_listener, admin_router).await.unwrap();
    });

    TestEnv {
        proxy_addr: format!("http://127.0.0.1:{proxy_port}"),
        admin_addr: format!("http://127.0.0.1:{admin_port}"),
        mock_origin_host: "test.local".to_string(),
    }
}
