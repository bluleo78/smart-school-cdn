/// storage-service 진입점
/// - gRPC StorageService 서버를 0.0.0.0:50051에서 기동
/// - HTTP 헬스체크 서버를 0.0.0.0:8080에서 기동 (Docker healthcheck용)
/// - 환경변수 CACHE_DIR, CACHE_MAX_SIZE_GB로 캐시 설정

mod cache;
mod grpc;

use std::{path::PathBuf, sync::Arc};
use axum::{Router, routing::get};
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::storage::storage_service_server::StorageServiceServer;
use grpc::StorageGrpc;

/// Docker healthcheck 및 로드밸런서용 헬스 엔드포인트
async fn health() -> &'static str { "ok" }

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 로그 초기화 — RUST_LOG 환경변수 또는 기본 info 레벨
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    // 캐시 디렉터리 및 최대 크기 설정
    let cache_dir = PathBuf::from(
        std::env::var("CACHE_DIR").unwrap_or_else(|_| "./cache".to_string()),
    );
    let max_bytes: u64 = std::env::var("CACHE_MAX_SIZE_GB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(20)
        * 1024
        * 1024
        * 1024;

    let cache = Arc::new(cache::CacheLayer::new(cache_dir, max_bytes));

    // 이슈 #389 — 디스크 임계 모니터 + 자동 evict.
    // 5분 주기 (STORAGE_EVICT_INTERVAL_SECS), hard 90% 도달 시 LRU 로 75% 까지 evict.
    // 임계 환경변수: STORAGE_EVICT_HARD_RATIO (0.9), STORAGE_EVICT_TARGET_RATIO (0.75).
    // 임계 미달 시 no-op. evict 진행 시 tracing::warn 로 운영 가시성 확보.
    let evict_cache = cache.clone();
    let evict_interval_secs: u64 = std::env::var("STORAGE_EVICT_INTERVAL_SECS")
        .ok().and_then(|s| s.parse().ok()).unwrap_or(300);
    let hard_ratio: f32 = std::env::var("STORAGE_EVICT_HARD_RATIO")
        .ok().and_then(|s| s.parse().ok()).filter(|v: &f32| *v > 0.0 && *v <= 1.0).unwrap_or(0.9);
    let target_ratio: f32 = std::env::var("STORAGE_EVICT_TARGET_RATIO")
        .ok().and_then(|s| s.parse().ok()).filter(|v: &f32| *v > 0.0 && *v < hard_ratio).unwrap_or(0.75);
    // 이슈 #433 — evict 결과를 admin-server optimization_events 에 기록.
    // ADMIN_SERVER_URL 미설정 시 fall back: docker-compose 서비스명. push 실패는 warn 로그만.
    let admin_url = std::env::var("ADMIN_SERVER_URL")
        .unwrap_or_else(|_| "http://admin-server:4001".to_string());
    let internal_token = std::env::var("INTERNAL_API_TOKEN").ok();
    let evict_http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("reqwest Client 생성 실패");
    tracing::info!(evict_interval_secs, hard_ratio, target_ratio, "[#389] 디스크 임계 evict 태스크 시작");
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(evict_interval_secs));
        // 첫 tick 즉시 발사 후 주기 반복
        loop {
            interval.tick().await;
            let usage = evict_cache.usage_ratio();
            if usage >= 0.8 {
                tracing::warn!(usage = format!("{:.1}%", usage * 100.0), "[#389] 디스크 사용률 80% 도달 (soft 알림)");
            }
            let freed = evict_cache.evict_to_ratio(hard_ratio, target_ratio).await;
            if freed > 0 {
                tracing::warn!(freed_bytes = freed, "[#389] LRU 자동 evict 실행");
                // 이슈 #433 — evict 이벤트 push. event_type=storage_evict / decision=auto_evict.
                // orig_size 에 freed_bytes 를 담아 누적 분석 가능하게 한다 (out_size 는 null).
                let endpoint = format!("{}/internal/events/batch", admin_url.trim_end_matches('/'));
                let ts = chrono::Utc::now().to_rfc3339();
                let payload = serde_json::json!({
                    "events": [{
                        "ts": ts,
                        "event_type": "storage_evict",
                        "host": "*",
                        "url": "storage://evict",
                        "decision": "auto_evict",
                        "orig_size": freed,
                        "elapsed_ms": 0
                    }]
                });
                let mut req = evict_http.post(&endpoint).json(&payload);
                if let Some(tok) = internal_token.as_deref() {
                    req = req.header("x-internal-token", tok);
                }
                match req.send().await {
                    Ok(r) if r.status().is_success() => {
                        tracing::debug!(freed_bytes = freed, "[#433] evict 이벤트 push 성공");
                    }
                    Ok(r) => tracing::warn!(status = %r.status(), "[#433] evict 이벤트 push 실패 — admin-server 응답"),
                    Err(e) => tracing::warn!(error = %e, "[#433] evict 이벤트 push 실패"),
                }
            }
        }
    });

    // gRPC 서버 빌드 — 최대 메시지 크기 64 MiB (디지털 교과서 콘텐츠 대응)
    let svc = StorageServiceServer::new(StorageGrpc { cache: cache.clone() })
        .max_decoding_message_size(64 * 1024 * 1024)
        .max_encoding_message_size(64 * 1024 * 1024);

    let grpc_addr = "0.0.0.0:50051".parse()?;
    tracing::info!("storage-service 시작 — gRPC :50051, HTTP health :8080");

    // HTTP 헬스체크 서버 — gRPC와 병행 실행.
    // 이슈 #283/#277 — ENABLE_DEV_SEED=true 일 때만 /dev/seed 엔드포인트 활성. dev 디자인 검증 전용.
    let dev_seed_enabled = std::env::var("ENABLE_DEV_SEED").ok().as_deref() == Some("true");
    let mut health_router = Router::new().route("/health", get(health));
    if dev_seed_enabled {
        let cache_for_seed = cache.clone();
        health_router = health_router.route(
            "/dev/seed",
            axum::routing::post(move || {
                let cache = cache_for_seed.clone();
                async move {
                    let n = cache.dev_seed_popular().await;
                    axum::Json(serde_json::json!({ "seeded_popular": n }))
                }
            }),
        );
        tracing::warn!("[dev-seed] /dev/seed 엔드포인트 활성 — 운영 빌드에서는 ENABLE_DEV_SEED 미설정 필수");
    }
    let health_listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    let health_server = tokio::spawn(async move {
        axum::serve(health_listener, health_router).await
    });

    tokio::select! {
        res = Server::builder().add_service(svc).serve(grpc_addr) => {
            res?;
        }
        res = health_server => {
            tracing::error!("HTTP health 서버 종료: {:?}", res);
            std::process::exit(1);
        }
    }

    Ok(())
}
