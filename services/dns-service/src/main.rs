/// dns-service 진입점
/// - DNS UDP 서버(:53), gRPC 서버(:50053), HTTP 헬스체크(:8082)를 병행 기동한다
mod dns;
mod grpc;
mod metrics;

use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
};
use axum::{Router, routing::get};
use tokio::sync::RwLock;
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use cdn_proto::dns::dns_service_server::DnsServiceServer;
use grpc::{DnsGrpc, DomainMap};
use metrics::{DnsMetrics, RecentQueries};

/// Docker healthcheck 및 로드밸런서용 헬스 엔드포인트
async fn health() -> &'static str { "ok" }

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 로깅 초기화 — RUST_LOG 환경변수 우선, 기본값 info
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    // DNS 쿼리 처리에 사용할 도메인 맵 (gRPC sync_domains로 업데이트)
    let domain_map: DomainMap = Arc::new(RwLock::new(HashMap::new()));

    // CDN IP: A 레코드 응답에 사용할 IP 주소
    let cdn_ip: Ipv4Addr = std::env::var("CDN_IP")
        .unwrap_or_else(|_| "127.0.0.1".to_string())
        .parse()
        .expect("CDN_IP 유효하지 않음");

    // 업스트림 DNS: 미등록 도메인 포워딩 대상 (기본: 8.8.8.8:53)
    let dns_upstream: SocketAddr = {
        let s = std::env::var("DNS_UPSTREAM").unwrap_or_else(|_| "8.8.8.8".to_string());
        if s.contains(':') {
            s.parse().expect("DNS_UPSTREAM 형식 오류")
        } else {
            format!("{s}:53").parse().unwrap()
        }
    };

    // gRPC 서버 (포트 50053)
    let addr = "0.0.0.0:50053".parse()?;
    tracing::info!("dns-service 시작 — UDP :53, gRPC :50053");

    // DNS UDP 서버를 태스크로 실행하고 핸들을 보관 — 종료 시 감지
    // domain_map 이동 전에 클론
    let dns_map = domain_map.clone();
    // Task 4 경계 최소 와이어링: 컴파일러를 만족시키기 위해 로컬 Arc만 DnsGrpc에 주입
    // Task 5에서 DNS 서버와 gRPC가 동일 Arc를 공유하도록 리팩토링 예정
    let dns_metrics = Arc::new(DnsMetrics::new());
    let dns_recent = Arc::new(RecentQueries::new(512));
    let svc = DnsServiceServer::new(DnsGrpc {
        domain_map,
        metrics: Arc::new(DnsMetrics::new()),
        recent:  Arc::new(RecentQueries::new(512)),
        cdn_ip:  cdn_ip.to_string(),
    });
    let dns_handle = tokio::spawn(async move {
        dns::run_dns_server(dns_map, dns_metrics, dns_recent, cdn_ip, dns_upstream).await;
    });

    // HTTP 헬스체크 서버 — Docker healthcheck용 (:8082)
    let health_router = Router::new().route("/health", get(health));
    let health_listener = tokio::net::TcpListener::bind("0.0.0.0:8082").await?;
    let health_server = tokio::spawn(async move {
        axum::serve(health_listener, health_router).await
    });

    tokio::select! {
        res = dns_handle => {
            tracing::error!("DNS UDP 서버 종료: {:?}", res);
            std::process::exit(1);
        }
        res = Server::builder().add_service(svc).serve(addr) => {
            res?;
        }
        res = health_server => {
            tracing::error!("HTTP health 서버 종료: {:?}", res);
        }
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("종료 신호 수신");
        }
    }

    Ok(())
}
