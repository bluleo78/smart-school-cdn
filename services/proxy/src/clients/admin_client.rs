/// admin-server HTTP JSON 클라이언트.
/// 현재 단 하나의 용도: 기동 시 도메인 snapshot pull (Phase 16-2).

use std::time::Duration;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct DomainSnapshotEntry {
    pub host: String,
    pub origin: String,
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Deserialize)]
struct SnapshotResponse {
    domains: Vec<DomainSnapshotEntry>,
}

/// admin-server `/api/domains/internal/snapshot` 호출.
/// 실패 시 지수 백오프 재시도(1,2,4,8,16초, 최대 총 ~30초).
/// 모두 실패하면 `Err`를 반환해 호출자가 빈 맵으로 기동할 수 있게 한다.
pub async fn fetch_domain_snapshot(
    base_url: &str,
) -> Result<Vec<DomainSnapshotEntry>, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?;
    let url = format!("{}/api/domains/internal/snapshot", base_url.trim_end_matches('/'));

    let mut delay = Duration::from_secs(1);
    let mut last_err: Option<reqwest::Error> = None;
    for attempt in 1..=5u32 {
        match client.get(&url).send().await.and_then(|r| r.error_for_status()) {
            Ok(resp) => {
                let body: SnapshotResponse = resp.json().await?;
                tracing::info!(count = body.domains.len(), attempt, "도메인 snapshot 수신");
                return Ok(body.domains);
            }
            Err(err) => {
                tracing::warn!(%err, attempt, "admin-server snapshot 실패 — 재시도");
                last_err = Some(err);
                if attempt < 5 {
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(16));
                }
            }
        }
    }
    Err(last_err.expect("루프에서 1회 이상 실패했다면 last_err는 Some"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_response_json을_역직렬화한다() {
        let raw = r#"{"domains":[
            {"host":"a.test","origin":"https://a","enabled":true,"description":"x"},
            {"host":"b.test","origin":"https://b","enabled":false,"description":""}
        ]}"#;
        let parsed: SnapshotResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.domains.len(), 2);
        assert_eq!(parsed.domains[0].host, "a.test");
        assert!(!parsed.domains[1].enabled);
    }
}
