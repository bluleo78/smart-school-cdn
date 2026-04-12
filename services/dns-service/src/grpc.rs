use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tonic::{Request, Response, Status};

use cdn_proto::dns::{
    dns_service_server::DnsService,
    HealthRequest, HealthResponse,
    SyncDomainsRequest, SyncDomainsResponse,
};

// DomainMap 타입 — dns.rs와 동일하게 유지
pub type DomainMap = Arc<RwLock<HashMap<String, String>>>;

pub struct DnsGrpc {
    pub(crate) domain_map: DomainMap,
}

#[tonic::async_trait]
impl DnsService for DnsGrpc {
    /// 도메인 목록을 수신하여 인메모리 맵을 교체한다
    async fn sync_domains(
        &self,
        req: Request<SyncDomainsRequest>,
    ) -> Result<Response<SyncDomainsResponse>, Status> {
        let domains = req.into_inner().domains;
        {
            let mut map = self.domain_map.write().await;
            map.clear();
            for d in &domains {
                map.insert(d.host.clone(), d.origin.clone());
            }
        }
        tracing::info!("DNS 도메인 동기화 완료: {}개", domains.len());
        Ok(Response::new(SyncDomainsResponse { success: true }))
    }

    /// 헬스체크 — 항상 online 반환
    async fn health(
        &self,
        _: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            online: true,
            latency_ms: 0,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Arc};
    use tokio::sync::RwLock;
    use tonic::Request;

    use cdn_proto::dns::{SyncDomainsRequest, HealthRequest, DnsDomain};

    /// 테스트용 DnsGrpc 인스턴스 생성
    fn make_grpc() -> DnsGrpc {
        DnsGrpc {
            domain_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    #[tokio::test]
    async fn sync_domains_는_맵을_갱신한다() {
        let grpc = make_grpc();
        let res = grpc
            .sync_domains(Request::new(SyncDomainsRequest {
                domains: vec![
                    DnsDomain { host: "textbook.com".to_string(), origin: "https://textbook.com".to_string() },
                    DnsDomain { host: "cdn.edu.net".to_string(), origin: "https://cdn.edu.net".to_string() },
                ],
            }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.success);
        let map = grpc.domain_map.read().await;
        assert_eq!(map.get("textbook.com").map(String::as_str), Some("https://textbook.com"));
        assert_eq!(map.len(), 2);
    }

    #[tokio::test]
    async fn sync_domains_는_기존_맵을_교체한다() {
        let grpc = make_grpc();
        // 첫 sync: 2개
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![
                DnsDomain { host: "old1.com".to_string(), origin: "https://old1.com".to_string() },
                DnsDomain { host: "old2.com".to_string(), origin: "https://old2.com".to_string() },
            ],
        }))
        .await
        .unwrap();

        // 두 번째 sync: 1개만 — 이전 항목 모두 제거
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![
                DnsDomain { host: "new1.com".to_string(), origin: "https://new1.com".to_string() },
            ],
        }))
        .await
        .unwrap();

        let map = grpc.domain_map.read().await;
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("new1.com"));
        assert!(!map.contains_key("old1.com"));
    }

    #[tokio::test]
    async fn sync_domains_빈_목록은_맵을_비운다() {
        let grpc = make_grpc();
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![DnsDomain { host: "x.com".to_string(), origin: "https://x.com".to_string() }],
        }))
        .await
        .unwrap();

        grpc.sync_domains(Request::new(SyncDomainsRequest { domains: vec![] }))
            .await
            .unwrap();

        let map = grpc.domain_map.read().await;
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn health_는_online_true를_반환한다() {
        let grpc = make_grpc();
        let res = grpc
            .health(Request::new(HealthRequest {}))
            .await
            .unwrap()
            .into_inner();

        assert!(res.online);
    }
}
