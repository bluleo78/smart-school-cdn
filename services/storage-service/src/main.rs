/// storage-service 진입점
/// - gRPC StorageService 서버를 0.0.0.0:50051에서 기동
/// - 환경변수 CACHE_DIR, CACHE_MAX_SIZE_GB로 캐시 설정

mod cache;
mod grpc;

use std::{path::PathBuf, sync::Arc};
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::storage::storage_service_server::StorageServiceServer;
use grpc::StorageGrpc;

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

    // gRPC 서버 빌드 — 최대 메시지 크기 64 MiB (디지털 교과서 콘텐츠 대응)
    let svc = StorageServiceServer::new(StorageGrpc { cache })
        .max_decoding_message_size(64 * 1024 * 1024)
        .max_encoding_message_size(64 * 1024 * 1024);

    let addr = "0.0.0.0:50051".parse()?;
    tracing::info!("storage-service 시작 — gRPC :50051");
    Server::builder().add_service(svc).serve(addr).await?;
    Ok(())
}
