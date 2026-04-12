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
