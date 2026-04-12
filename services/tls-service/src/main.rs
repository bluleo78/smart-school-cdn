/// tls-service 진입점
/// - TlsManager 초기화 후 gRPC 서버를 :50052에서 기동한다
mod tls;
mod grpc;

use std::{path::PathBuf, sync::Arc};
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::tls::tls_service_server::TlsServiceServer;
use grpc::TlsGrpc;

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
    let addr = "0.0.0.0:50052".parse()?;
    tracing::info!("tls-service 시작 — gRPC :50052");
    Server::builder().add_service(svc).serve(addr).await?;
    Ok(())
}
