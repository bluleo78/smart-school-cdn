/// 프록시 중계 동작 통합 테스트
/// Host 헤더 기반 라우팅, 원본 서버 중계, 응답 헤더 주입,
/// 요청 로그/카운터 기록까지 end-to-end로 검증한다.
mod common;

use common::setup_env;
use serde_json::Value;

#[tokio::test]
async fn 미등록_도메인_요청은_404를_반환한다() {
    let env = setup_env().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/anything", env.proxy_addr))
        .header("host", "unknown.invalid")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn 등록된_도메인_요청은_원본_서버로_중계된다() {
    let env = setup_env().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/hello", env.proxy_addr))
        .header("host", &env.mock_origin_host)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    // CDN 프록시 식별 헤더가 붙어있어야 함
    assert_eq!(
        resp.headers().get("x-served-by").unwrap(),
        "smart-school-cdn"
    );
    // Cache-Control 없는 응답 → 캐시 가능, 첫 요청이므로 MISS
    assert_eq!(resp.headers().get("x-cache-status").unwrap(), "MISS");

    // 응답 본문은 mock origin에서 온 문자열 그대로
    let body = resp.text().await.unwrap();
    assert_eq!(body, "Hello from origin");
}

#[tokio::test]
async fn 프록시_요청_후_관리_API에서_로그와_카운터가_증가한다() {
    let env = setup_env().await;
    let client = reqwest::Client::new();

    // 프록시 경유 요청 2회
    for _ in 0..2 {
        client
            .get(format!("{}/hello", env.proxy_addr))
            .header("host", &env.mock_origin_host)
            .send()
            .await
            .unwrap();
    }

    // 관리 API에서 상태 확인
    let status: Value = client
        .get(format!("{}/status", env.admin_addr))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["request_count"], 2);

    // 로그 목록 확인 — 최신순 2건
    let logs: Value = client
        .get(format!("{}/requests", env.admin_addr))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let logs = logs.as_array().unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0]["host"], "test.local");
    assert_eq!(logs[0]["url"], "/hello");
    assert_eq!(logs[0]["status_code"], 200);
    assert_eq!(logs[0]["method"], "GET");
}
