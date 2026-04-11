use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // 로깅 초기화
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    tracing::info!("Proxy Service started");

    // TODO: Phase 1에서 axum HTTP 서버 구현
    tokio::signal::ctrl_c().await.unwrap();
    tracing::info!("Proxy Service shutting down");
}
