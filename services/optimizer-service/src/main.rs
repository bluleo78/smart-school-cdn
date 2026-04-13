/// optimizer-service 진입점
/// - gRPC 서버(:50054), HTTP 헬스체크(:8083) 병행 기동
mod optimizer;
mod grpc;

use std::sync::Arc;
use axum::{Router, routing::get};
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::optimizer::optimizer_service_server::OptimizerServiceServer;
use grpc::OptimizerGrpc;
use optimizer::OptimizerDb;

/// Docker healthcheck용 헬스 엔드포인트
async fn health() -> &'static str { "ok" }

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let db_path = std::env::var("OPTIMIZER_DB_PATH")
        .unwrap_or_else(|_| "./data/optimizer.db".to_string());

    let db = Arc::new(OptimizerDb::open(&db_path)?);

    let grpc_addr = "0.0.0.0:50054".parse()?;
    let svc = OptimizerServiceServer::new(OptimizerGrpc { db });

    tracing::info!("optimizer-service 시작 — gRPC :50054, health :8083");

    // HTTP 헬스체크 서버
    let health_router = Router::new().route("/health", get(health));
    let health_listener = tokio::net::TcpListener::bind("0.0.0.0:8083").await?;
    let health_server = tokio::spawn(async move {
        axum::serve(health_listener, health_router).await
    });

    tokio::select! {
        res = Server::builder().add_service(svc).serve(grpc_addr) => { res?; }
        res = health_server => { tracing::error!("health 서버 종료: {:?}", res); }
        _ = tokio::signal::ctrl_c() => { tracing::info!("종료 신호 수신"); }
    }

    Ok(())
}
