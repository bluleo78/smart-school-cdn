/// tls-service 진입점
/// - TlsManager 초기화 후 gRPC 서버를 :50052에서 기동한다
/// - HTTP 헬스체크 서버를 :8081에서 병행 기동 (Docker healthcheck용)
mod tls;
mod grpc;

use std::{path::PathBuf, sync::Arc};
use axum::{Router, routing::get};
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::tls::tls_service_server::TlsServiceServer;
use grpc::TlsGrpc;

/// Docker healthcheck 및 로드밸런서용 헬스 엔드포인트
async fn health() -> &'static str { "ok" }

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    // ring CryptoProvider 등록 — rustls 0.23 이상 필수
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("ring CryptoProvider 설치 실패");

    let certs_dir = PathBuf::from(
        std::env::var("CERTS_DIR").unwrap_or_else(|_| "./certs".to_string()),
    );

    // TlsManager::load_or_create는 Arc<TlsManager>를 반환한다
    let tls_manager: Arc<tls::TlsManager> =
        tls::TlsManager::load_or_create(&certs_dir)
            .expect("TLS 관리자 초기화 실패");

    let svc = TlsServiceServer::new(TlsGrpc { tls_manager });
    let grpc_addr = "0.0.0.0:50052".parse()?;
    tracing::info!("tls-service 시작 — gRPC :50052, HTTP health :8081");

    // HTTP 헬스체크 서버 — gRPC와 병행 실행
    let health_router = Router::new().route("/health", get(health));
    let health_listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await?;
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
