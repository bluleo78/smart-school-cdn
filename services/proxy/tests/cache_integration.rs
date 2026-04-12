/// 캐시 통합 테스트 — 실제 axum 서버 + mock 원본 서버를 기동하여 HIT/MISS/BYPASS 검증
use std::collections::HashMap;
use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use reqwest::Client;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use proxy::cache::CacheLayer;
use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::tls::TlsManager;
use proxy::{DomainMap, build_admin_router, build_proxy_router, ProxyState};

/// 테스트용 mock 원본 서버 + 프록시 서버 기동
/// 반환: (proxy_addr, admin_addr, _tmp_dir, _tls_tmp_dir)
async fn start_test_proxy(
    response_headers: Vec<(&'static str, &'static str)>,
) -> (String, String, TempDir, TempDir) {
    // mock 원본 서버 — 지정 헤더와 함께 "hello" 반환
    let origin_router = Router::new().route(
        "/{*path}",
        get(move || async move {
            let mut resp = axum::response::Response::builder().status(200);
            for (k, v) in &response_headers {
                resp = resp.header(*k, *v);
            }
            resp.body(axum::body::Body::from("hello")).unwrap()
        }),
    );
    let origin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin_addr = origin_listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(origin_listener, origin_router).await.unwrap();
    });

    // 프록시 설정 — test.local → mock 원본
    let mut domains = HashMap::new();
    domains.insert(
        "test.local".to_string(),
        format!("http://{}", origin_addr),
    );
    let config = Arc::new(ProxyConfig::with_domains(domains));
    let state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let client = Client::new();
    let tmp = tempfile::tempdir().unwrap();
    let cache = Arc::new(CacheLayer::new(tmp.path().to_path_buf(), 100 * 1024 * 1024));

    // 프록시 + 관리 서버 기동
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap().to_string();
    let admin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let admin_addr = admin_listener.local_addr().unwrap().to_string();
    let tls_tmp = tempfile::tempdir().unwrap();
    let tls_manager = TlsManager::load_or_create(tls_tmp.path()).unwrap();

    // 도메인 맵 — test.local을 mock 원본으로 라우팅
    let domain_map: DomainMap = Arc::new(RwLock::new({
        let mut m = HashMap::new();
        m.insert("test.local".to_string(), format!("http://{}", origin_addr));
        m
    }));

    let ps = ProxyState {
        shared: state.clone(),
        config,
        http_client: client,
        cache: cache.clone(),
        tls_manager: tls_manager.clone(),
        domain_map: domain_map.clone(),
    };
    let proxy_router = build_proxy_router(ps);
    let admin_router = build_admin_router(state.clone(), cache, tls_manager, domain_map);

    tokio::spawn(async move { axum::serve(proxy_listener, proxy_router).await.unwrap() });
    tokio::spawn(async move { axum::serve(admin_listener, admin_router).await.unwrap() });

    (proxy_addr, admin_addr, tmp, tls_tmp)
}

#[tokio::test]
async fn 동일_url_두번_요청하면_첫번째_miss_두번째_hit() {
    let (proxy_addr, _admin_addr, _tmp, _tls_tmp) = start_test_proxy(vec![]).await;
    let client = Client::new();

    // 첫 번째 요청 → MISS
    let resp1 = client
        .get(format!("http://{}/img.png", proxy_addr))
        .header("Host", "test.local")
        .send()
        .await
        .unwrap();
    assert_eq!(resp1.headers()["X-Cache-Status"], "MISS");

    // 두 번째 요청 → HIT
    let resp2 = client
        .get(format!("http://{}/img.png", proxy_addr))
        .header("Host", "test.local")
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.headers()["X-Cache-Status"], "HIT");
    assert_eq!(resp2.bytes().await.unwrap(), Bytes::from("hello"));
}

#[tokio::test]
async fn no_store_응답은_bypass_처리된다() {
    let (proxy_addr, _admin_addr, _tmp, _tls_tmp) =
        start_test_proxy(vec![("Cache-Control", "no-store")]).await;
    let client = Client::new();

    let resp1 = client
        .get(format!("http://{}/secret", proxy_addr))
        .header("Host", "test.local")
        .send()
        .await
        .unwrap();
    assert_eq!(resp1.headers()["X-Cache-Status"], "BYPASS");

    // no-store → 두 번째도 BYPASS (캐시 저장 안 됨)
    let resp2 = client
        .get(format!("http://{}/secret", proxy_addr))
        .header("Host", "test.local")
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.headers()["X-Cache-Status"], "BYPASS");
}

#[tokio::test]
async fn 캐시_통계_api가_hit_miss를_반영한다() {
    let (proxy_addr, admin_addr, _tmp, _tls_tmp) = start_test_proxy(vec![]).await;
    let client = Client::new();

    // 2회 요청 (MISS + HIT)
    for _ in 0..2 {
        client
            .get(format!("http://{}/file", proxy_addr))
            .header("Host", "test.local")
            .send()
            .await
            .unwrap();
    }

    let stats: serde_json::Value = client
        .get(format!("http://{}/cache/stats", admin_addr))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(stats["miss_count"], 1);
    assert_eq!(stats["hit_count"], 1);
}
