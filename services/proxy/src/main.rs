/// Smart School CDN Proxy Service
/// HTTP 리버스 프록시(8080) + HTTPS 443 + 관리 API(8081)
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, RwLock};
use tracing_subscriber::EnvFilter;

use rustls::{ServerConfig, server::{ClientHello, ResolvesServerCert}, sign::CertifiedKey};
use axum_server::tls_rustls::RustlsConfig;

use proxy::{DomainMap, MemoryCacheEntry, TextCompressConfig, build_admin_router, build_proxy_router, ProxyState};
use proxy::clients::optimizer_client::OptimizerClient;
use proxy::clients::storage_client::StorageClient;
use proxy::clients::tls_client::{TlsClient, CertCache};
use proxy::coalescer::Coalescer;
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
        // std::sync::Mutex — SNI 핸들러는 sync 컨텍스트, tokio Mutex 사용 불가
        self.cert_cache.lock().unwrap().get(domain).cloned()
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
    let http_client = proxy::clients::http::make_origin_http_client();
    let domain_map: DomainMap = Arc::new(RwLock::new(HashMap::new()));
    let cert_cache = tls_client.cert_cache.clone();

    // Phase 16-2: admin-server로부터 도메인 snapshot을 pull해 domain_map을 초기화한다.
    // push 경로(admin-server HealthMonitor)에만 의존하면 proxy 단독 재기동 시
    // domain_map이 공란이 되어 TLS SNI가 access denied로 터진다.
    let admin_url = std::env::var("ADMIN_SNAPSHOT_URL")
        .unwrap_or_else(|_| "http://admin-server:4001".to_string());
    match proxy::clients::admin_client::fetch_domain_snapshot(&admin_url).await {
        Ok(entries) => {
            let mut map = domain_map.write().await;
            for e in entries.iter().filter(|e| e.enabled) {
                map.insert(e.host.clone(), e.origin.clone());
            }
            tracing::info!(count = map.len(), "domain_map initialized from admin snapshot");
        }
        Err(err) => {
            tracing::warn!(%err, "admin snapshot pull 실패 — 빈 도메인맵으로 기동. admin push 경로 대기");
        }
    }

    let optimizer_url = std::env::var("OPTIMIZER_GRPC_URL")
        .unwrap_or_else(|_| "http://optimizer-service:50054".to_string());
    let optimizer = match OptimizerClient::connect(&optimizer_url).await {
        Ok(client) => {
            tracing::info!("optimizer-service 연결 성공: {}", optimizer_url);
            Some(Arc::new(Mutex::new(client)))
        }
        Err(e) => {
            tracing::warn!("optimizer-service 연결 실패 (최적화 비활성화): {}", e);
            None
        }
    };

    let storage = Arc::new(Mutex::new(storage));
    let tls_client = Arc::new(Mutex::new(tls_client));

    // 매분 히트율 스냅샷 기록 배경 태스크
    let state_for_snapshot = shared_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            state_for_snapshot.write().await.record_hit_rate_snapshot();
        }
    });

    // L1 메모리 캐시 — 환경변수 기반 용량 설정
    let memory_cache_max_bytes: u64 = std::env::var("MEMORY_CACHE_MAX_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256 * 1024 * 1024); // 기본 256MB
    let memory_cache_ttl_secs: u64 = std::env::var("MEMORY_CACHE_TTL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(600);
    let memory_cache: moka::future::Cache<String, Arc<MemoryCacheEntry>> =
        moka::future::Cache::builder()
            .max_capacity(memory_cache_max_bytes)
            // weigher 없으면 max_capacity가 엔트리 수로 해석되므로 바이트 기반 가중치 설정
            .weigher(|_k: &String, v: &Arc<MemoryCacheEntry>| {
                (v.body.len() as u64).min(u32::MAX as u64) as u32
            })
            .time_to_live(std::time::Duration::from_secs(memory_cache_ttl_secs))
            .build();
    tracing::info!(
        max_bytes = memory_cache_max_bytes,
        ttl_secs = memory_cache_ttl_secs,
        "L1 메모리 캐시 초기화"
    );

    let counters: proxy::DomainCounters = Arc::new(std::sync::RwLock::new(HashMap::new()));

    // 최적화 이벤트 배치 push 태스크 시작 — admin-server /internal/events/batch 로 전송
    // 태스크 JoinHandle은 _events_pusher로 유지해 태스크가 drop되지 않도록 한다
    let events_pusher = proxy::events::start(proxy::events::EventsConfig::from_env());
    let events_sender = Some(events_pusher.sender.clone());
    // 태스크 핸들을 main 스코프에 유지하기 위해 변수로 바인딩 (선두 `_`로 unused 경고 억제)
    let _events_handle = events_pusher.handle;

    let ps = ProxyState {
        shared: shared_state.clone(),
        http_client,
        storage: storage.clone(),
        tls_client: tls_client.clone(),
        optimizer: optimizer.clone(),              // optimizer gRPC 클라이언트
        domain_map: domain_map.clone(),
        cert_cache: cert_cache.clone(),
        coalescer: Arc::new(Coalescer::new()),
        memory_cache: memory_cache.clone(),
        counters: counters.clone(),
        events: events_sender,
        text_compress: TextCompressConfig::from_env(),
        // Phase 16-1: MISS 백그라운드 저장 중복 차단 트래커
        save_tracker: proxy::save_tracker::SaveTracker::new(),
    };

    let proxy_router = build_proxy_router(ps);
    let admin_router = build_admin_router(
        shared_state, storage, tls_client, domain_map, cert_cache.clone(), memory_cache, counters,
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
