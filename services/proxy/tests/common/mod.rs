/// 통합 테스트 공용 헬퍼
/// - mock 원본 서버 + proxy 라우터 + admin 라우터를 임의 포트에 띄워서
///   end-to-end 호출이 가능한 TestEnv를 반환한다.
/// - tests/ 하위의 각 통합 테스트 파일이 `mod common;`으로 가져다 쓴다.
use std::collections::HashMap;
use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use proxy::cache::CacheLayer;
use proxy::state::{AppState, SharedState};
use proxy::tls::TlsManager;
use proxy::{DomainMap, build_admin_router, build_proxy_router, ProxyState};
use tokio::sync::RwLock;

/// 한 번의 테스트에 필요한 엔드포인트 주소 묶음
pub struct TestEnv {
    pub proxy_addr: String,
    pub admin_addr: String,
    pub mock_origin_host: String,
    /// TlsManager 임시 디렉터리 — 테스트 종료 전까지 삭제되지 않아야 한다.
    _tls_tmp: tempfile::TempDir,
}

/// 테스트 환경 부트스트랩
/// 1. mock 원본 서버를 임의 포트에 바인드 (GET /hello → "Hello from origin")
/// 2. domain_map에 "test.local" → mock origin URL 매핑 등록
/// 3. proxy 라우터 / admin 라우터를 각각 임의 포트에 바인드
pub async fn setup_env() -> TestEnv {
    // 1. mock 원본 서버
    let origin_router = Router::new().route("/hello", get(|| async { "Hello from origin" }));
    let origin_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin_port = origin_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(origin_listener, origin_router).await.unwrap();
    });

    // 2. 공유 상태 + HTTP 클라이언트 + CacheLayer + TlsManager
    let mock_origin_url = format!("http://127.0.0.1:{origin_port}");
    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let http_client = reqwest::Client::new();
    let cache = Arc::new(CacheLayer::new(std::path::PathBuf::from("/tmp/test-cache"), 64 * 1024 * 1024));
    let tls_tmp = tempfile::tempdir().unwrap();
    let tls_manager = TlsManager::load_or_create(tls_tmp.path()).unwrap();

    // domain_map — test.local → mock origin 매핑 주입
    let domain_map: DomainMap = Arc::new(RwLock::new({
        let mut m = HashMap::new();
        m.insert("test.local".to_string(), mock_origin_url.clone());
        m
    }));

    // 3. 프록시 라우터 → 임의 포트 바인드
    let ps = ProxyState {
        shared: shared_state.clone(),
        http_client,
        cache: cache.clone(),
        tls_manager: tls_manager.clone(),
        domain_map: domain_map.clone(),
    };
    let proxy_router = build_proxy_router(ps);
    let proxy_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = proxy_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(proxy_listener, proxy_router).await.unwrap();
    });

    // 5. 관리 API 라우터 → 임의 포트 바인드
    let admin_router = build_admin_router(shared_state.clone(), cache, tls_manager, domain_map);
    let admin_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let admin_port = admin_listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(admin_listener, admin_router).await.unwrap();
    });

    TestEnv {
        proxy_addr: format!("http://127.0.0.1:{proxy_port}"),
        admin_addr: format!("http://127.0.0.1:{admin_port}"),
        mock_origin_host: "test.local".to_string(),
        _tls_tmp: tls_tmp,
    }
}
