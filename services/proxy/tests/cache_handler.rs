/// 캐시 관리 API 핸들러 통합 테스트
/// GET /cache/stats, GET /cache/popular, DELETE /cache/purge 엔드포인트의
/// 응답 구조·상태 코드·유효성 검증을 수행한다.
use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use reqwest::Client;
use tempfile::TempDir;
use tokio::net::TcpListener;

use proxy::cache::CacheLayer;
use proxy::config::ProxyConfig;
use proxy::state::{AppState, SharedState};
use proxy::{build_admin_router, build_proxy_router};
use serde_json::{json, Value};
use tokio::sync::RwLock;

/// 캐시 관리 테스트용 환경
/// proxy + admin 라우터를 임의 포트에 기동하여 admin_addr을 반환한다.
struct CacheTestEnv {
    admin_addr: String,
    /// TempDir을 보유하여 테스트 종료 전까지 디렉터리가 삭제되지 않게 한다.
    _tmp: TempDir,
}

/// 테스트 환경 부트스트랩 — CacheLayer를 포함한 admin 라우터 기동
async fn setup_cache_env() -> CacheTestEnv {
    // mock 원본 서버 — 단순 응답 (캐시 관리 테스트에서는 실제 호출 불필요)
    let origin_router = Router::new();
    let origin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    tokio::spawn(async move {
        axum::serve(origin_listener, origin_router).await.unwrap();
    });

    // 프록시 설정
    let domains: HashMap<String, String> = HashMap::new();
    let config = Arc::new(ProxyConfig::with_domains(domains));
    let state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let client = Client::new();

    // 임시 디렉터리에 CacheLayer 생성 (100 MiB 한도)
    let tmp = tempfile::tempdir().unwrap();
    let cache = Arc::new(CacheLayer::new(tmp.path().to_path_buf(), 100 * 1024 * 1024));

    // 프록시 라우터 — admin과 별도 포트
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_router = build_proxy_router(state.clone(), config, client, cache.clone());
    tokio::spawn(async move { axum::serve(proxy_listener, proxy_router).await.unwrap() });

    // 관리 API 라우터 — cache 포함
    let admin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let admin_port = admin_listener.local_addr().unwrap().port();
    let admin_router = build_admin_router(state, cache);
    tokio::spawn(async move { axum::serve(admin_listener, admin_router).await.unwrap() });

    CacheTestEnv {
        admin_addr: format!("http://127.0.0.1:{admin_port}"),
        _tmp: tmp,
    }
}

/// GET /cache/stats — 초기 hit_count, miss_count, entry_count가 모두 0임을 검증한다.
#[tokio::test]
async fn cache_stats_초기값은_모두_0이다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    let resp = client
        .get(format!("{}/cache/stats", env.admin_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    // 요청이 없으므로 카운터는 모두 0이어야 한다
    assert_eq!(body["hit_count"], 0);
    assert_eq!(body["miss_count"], 0);
    assert_eq!(body["entry_count"], 0);
}

/// GET /cache/stats — 응답 JSON에 필수 필드가 존재하는지 확인한다.
#[tokio::test]
async fn cache_stats_응답_구조가_올바르다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    let resp = client
        .get(format!("{}/cache/stats", env.admin_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    // 캐시 통계 응답에 반드시 포함되어야 할 필드들
    assert!(body.get("hit_count").is_some(), "hit_count 필드 없음");
    assert!(body.get("miss_count").is_some(), "miss_count 필드 없음");
    assert!(body.get("hit_rate").is_some(), "hit_rate 필드 없음");
    assert!(body.get("total_size_bytes").is_some(), "total_size_bytes 필드 없음");
    assert!(body.get("entry_count").is_some(), "entry_count 필드 없음");
}

/// GET /cache/popular — 초기에 캐시 항목이 없으므로 빈 배열을 반환해야 한다.
#[tokio::test]
async fn cache_popular_초기에는_빈_배열을_반환한다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    let resp = client
        .get(format!("{}/cache/popular", env.admin_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    // 초기 상태에서 인기 콘텐츠 목록은 비어있어야 한다
    assert!(body.as_array().is_some(), "응답이 배열이 아님");
    assert_eq!(body.as_array().unwrap().len(), 0);
}

/// DELETE /cache/purge — type=all 요청은 200 + purged 필드를 반환해야 한다.
#[tokio::test]
async fn cache_purge_all_타입은_성공한다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    let resp = client
        .delete(format!("{}/cache/purge", env.admin_addr))
        .json(&json!({"type": "all"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body: Value = resp.json().await.unwrap();
    // purge 성공 시 삭제된 항목 수와 해제된 바이트 수를 포함해야 한다
    assert!(body.get("purged_count").is_some(), "purged_count 필드 없음");
    assert!(body.get("freed_bytes").is_some(), "freed_bytes 필드 없음");
}

/// DELETE /cache/purge — type=url 요청에 target이 없으면 400을 반환해야 한다.
#[tokio::test]
async fn cache_purge_url_타입은_target_필수다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    // target 없이 type=url만 전송 — 필수 파라미터 누락
    let resp = client
        .delete(format!("{}/cache/purge", env.admin_addr))
        .json(&json!({"type": "url"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

/// DELETE /cache/purge — type=domain 요청에 target이 없으면 400을 반환해야 한다.
#[tokio::test]
async fn cache_purge_domain_타입은_target_필수다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    // target 없이 type=domain만 전송 — 필수 파라미터 누락
    let resp = client
        .delete(format!("{}/cache/purge", env.admin_addr))
        .json(&json!({"type": "domain"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

/// DELETE /cache/purge — type 필드가 없으면 4xx(400 또는 422)를 반환해야 한다.
/// axum의 Json 추출기는 역직렬화 오류 시 422를 반환하므로 422를 허용한다.
#[tokio::test]
async fn cache_purge_type_없으면_400이다() {
    let env = setup_cache_env().await;
    let client = Client::new();

    // type 필드 자체가 없는 요청 — 잘못된 요청 형식
    let resp = client
        .delete(format!("{}/cache/purge", env.admin_addr))
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    // axum Json 추출기 오류 → 422, 핸들러 직접 반환 → 400
    assert!(
        resp.status() == 400 || resp.status() == 422,
        "예상: 400 또는 422, 실제: {}",
        resp.status()
    );
}
