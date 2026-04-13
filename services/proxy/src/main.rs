/// Smart School CDN Proxy Service
/// HTTP 리버스 프록시(8080) + HTTPS 443 + 관리 API(8081)
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, RwLock};
use tracing_subscriber::EnvFilter;

use rustls::{ServerConfig, server::{ClientHello, ResolvesServerCert}, sign::CertifiedKey};
use axum_server::tls_rustls::RustlsConfig;

use proxy::{DomainMap, build_admin_router, build_proxy_router, ProxyState};
use proxy::clients::optimizer_client::OptimizerClient;
use proxy::clients::storage_client::StorageClient;
use proxy::clients::tls_client::{TlsClient, CertCache};
use proxy::state::{AppState, SharedState};

/// rustls SNI 핸들러 — 로컬 cert_cache에서 CertifiedKey 조회 (sync)
struct SniCertResolver {
    cert_cache: CertCache,
}

impl std::fmt::Debug for SniCertResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SniCertResolver").finish()
    }
}

impl ResolvesServerCert for SniCertResolver {
    fn resolve(&self, client_hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        let domain = client_hello.server_name()?;
        // blocking_lock: SNI 핸들러는 sync 컨텍스트
        self.cert_cache.blocking_lock().get(domain).cloned()
    }
}

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider()
        .install_default().expect("ring CryptoProvider 설치 실패");

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let storage_url = std::env::var("STORAGE_GRPC_URL")
        .unwrap_or_else(|_| "http://storage-service:50051".to_string());
    let tls_url = std::env::var("TLS_GRPC_URL")
        .unwrap_or_else(|_| "http://tls-service:50052".to_string());

    let storage = StorageClient::connect(&storage_url).await
        .expect("storage-service gRPC 연결 실패");
    let tls_client = TlsClient::connect(&tls_url).await
        .expect("tls-service gRPC 연결 실패");

    let shared_state: SharedState = Arc::new(RwLock::new(AppState::new()));
    let http_client = reqwest::Client::new();
    let domain_map: DomainMap = Arc::new(RwLock::new(HashMap::new()));
    let cert_cache = tls_client.cert_cache.clone();

    let optimizer_url = std::env::var("OPTIMIZER_GRPC_URL")
        .unwrap_or_else(|_| "http://optimizer-service:50054".to_string());
    let optimizer = OptimizerClient::connect(&optimizer_url).await
        .expect("optimizer-service gRPC 연결 실패");

    let storage = Arc::new(Mutex::new(storage));
    let tls_client = Arc::new(Mutex::new(tls_client));
    let optimizer = Arc::new(Mutex::new(optimizer));

    // 매분 히트율 스냅샷 기록 배경 태스크
    let state_for_snapshot = shared_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            state_for_snapshot.write().await.record_hit_rate_snapshot();
        }
    });

    let ps = ProxyState {
        shared: shared_state.clone(),
        http_client,
        storage: storage.clone(),
        tls_client: tls_client.clone(),
        optimizer: optimizer.clone(),              // optimizer gRPC 클라이언트
        domain_map: domain_map.clone(),
        cert_cache: cert_cache.clone(),
    };

    let proxy_router = build_proxy_router(ps);
    let admin_router = build_admin_router(
        shared_state, storage, tls_client, domain_map, cert_cache.clone(),
    );

    let server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(SniCertResolver { cert_cache }));
    let rustls_config = RustlsConfig::from_config(Arc::new(server_config));

    tracing::info!("Proxy Service 시작 — HTTP :8080, HTTPS :443, Admin :8081");

    let https_router = proxy_router.clone();
    let proxy_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
        axum::serve(listener, proxy_router).await.unwrap();
    });
    let https_server = tokio::spawn(async move {
        axum_server::bind_rustls("0.0.0.0:443".parse().unwrap(), rustls_config)
            .serve(https_router.into_make_service()).await.unwrap();
    });
    let admin_server = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();
        axum::serve(listener, admin_router).await.unwrap();
    });

    tokio::select! {
        _ = proxy_server  => tracing::error!("HTTP 프록시 서버 종료"),
        _ = https_server  => tracing::error!("HTTPS 프록시 서버 종료"),
        _ = admin_server  => tracing::error!("Admin API 서버 종료"),
        _ = tokio::signal::ctrl_c() => tracing::info!("종료 신호 수신"),
    }
}
