/// 관리 API(/status, /requests) 통합 테스트
/// Admin Server가 proxy의 상태/로그를 조회하는 경로를 검증한다.
mod common;

use common::setup_env;
use serde_json::Value;

#[tokio::test]
async fn status는_온라인_상태를_반환한다() {
    let env = setup_env().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/status", env.admin_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let status: Value = resp.json().await.unwrap();
    assert_eq!(status["online"], true);
    assert_eq!(status["request_count"], 0);
}

#[tokio::test]
async fn 초기_요청_로그는_비어있다() {
    let env = setup_env().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/requests", env.admin_addr))
        .send()
        .await
        .unwrap();
    let logs: Value = resp.json().await.unwrap();
    assert_eq!(logs.as_array().unwrap().len(), 0);
}
