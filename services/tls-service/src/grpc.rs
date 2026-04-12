/// TLS gRPC 서비스 구현
/// - TlsManager를 래핑하여 proto 정의 RPC를 제공한다
use std::sync::Arc;
use tonic::{Request, Response, Status};

use cdn_proto::tls::{
    tls_service_server::TlsService,
    CertRequest, CertResponse,
    Empty, CaCertResponse,
    CertListResponse, CertInfo as ProtoCertInfo,
    SyncDomainsRequest, SyncDomainsResponse,
    HealthRequest, HealthResponse,
};

use crate::tls::TlsManager;

/// gRPC 핸들러 — TlsManager Arc를 공유한다
pub struct TlsGrpc {
    pub(crate) tls_manager: Arc<TlsManager>,
}

#[tonic::async_trait]
impl TlsService for TlsGrpc {
    /// 도메인 인증서 조회 또는 온디맨드 발급
    async fn get_or_issue_cert(
        &self, req: Request<CertRequest>,
    ) -> Result<Response<CertResponse>, Status> {
        let domain = req.into_inner().domain;
        match self.tls_manager.get_or_issue(&domain) {
            Some(cached) => Ok(Response::new(CertResponse {
                found:    true,
                cert_pem: cached.cert_pem.clone(),
                key_pem:  cached.key_pem.clone(),
            })),
            None => {
                tracing::error!("도메인 {} 인증서 발급 실패", domain);
                Err(Status::internal(format!("인증서 발급 실패: {domain}")))
            }
        }
    }

    /// CA 인증서 PEM 반환 (클라이언트 신뢰 설치용)
    async fn get_ca_cert(
        &self, _: Request<Empty>,
    ) -> Result<Response<CaCertResponse>, Status> {
        Ok(Response::new(CaCertResponse {
            cert_pem: self.tls_manager.ca_cert_pem.clone(),
        }))
    }

    /// 현재 캐시된 인증서 목록 반환
    async fn list_certificates(
        &self, _: Request<Empty>,
    ) -> Result<Response<CertListResponse>, Status> {
        let certs = self.tls_manager.list_certificates()
            .into_iter()
            .map(|c| ProtoCertInfo {
                domain:     c.domain,
                issued_at:  c.issued_at,   // 이미 RFC3339 문자열
                expires_at: c.expires_at,  // 이미 RFC3339 문자열
                status:     "active".to_string(),
            })
            .collect();
        Ok(Response::new(CertListResponse { certs }))
    }

    /// 수신된 도메인 목록에 대해 인증서 사전 발급
    async fn sync_domains(
        &self, req: Request<SyncDomainsRequest>,
    ) -> Result<Response<SyncDomainsResponse>, Status> {
        let domains = req.into_inner().domains;
        let mut failed = 0u32;
        for d in &domains {
            match self.tls_manager.get_or_issue(&d.host) {
                Some(_) => {},
                None => {
                    tracing::warn!("sync_domains: {} 인증서 발급 실패", d.host);
                    failed += 1;
                }
            }
        }
        let success = failed == 0;
        if !success {
            tracing::error!("sync_domains: {}개 도메인 인증서 발급 실패 (총 {}개)", failed, domains.len());
        }
        Ok(Response::new(SyncDomainsResponse { success }))
    }

    /// 헬스체크
    async fn health(
        &self, _: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse { online: true, latency_ms: 0 }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;
    use tonic::Request;

    use cdn_proto::tls::{CertRequest, Empty, SyncDomainsRequest, HealthRequest, TlsDomain};
    use crate::tls::TlsManager;

    /// 테스트용 TlsGrpc 인스턴스 생성 (임시 디렉터리에 CA 생성)
    fn make_grpc() -> (TlsGrpc, TempDir) {
        let dir = TempDir::new().unwrap();
        let tls_manager = TlsManager::load_or_create(dir.path()).expect("TlsManager 초기화 실패");
        (TlsGrpc { tls_manager }, dir)
    }

    #[tokio::test]
    async fn get_or_issue_cert_는_유효한_pem을_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .get_or_issue_cert(Request::new(CertRequest {
                domain: "test.example.com".to_string(),
            }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.found);
        assert!(res.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(res.key_pem.contains("BEGIN"));
    }

    #[tokio::test]
    async fn get_ca_cert_는_ca_pem을_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .get_ca_cert(Request::new(Empty {}))
            .await
            .unwrap()
            .into_inner();

        assert!(res.cert_pem.contains("BEGIN CERTIFICATE"));
    }

    #[tokio::test]
    async fn list_certificates_는_발급된_인증서_목록을_반환한다() {
        let (grpc, _dir) = make_grpc();
        // 인증서 발급
        grpc.get_or_issue_cert(Request::new(CertRequest {
            domain: "listtest.example.com".to_string(),
        }))
        .await
        .unwrap();

        let res = grpc
            .list_certificates(Request::new(Empty {}))
            .await
            .unwrap()
            .into_inner();

        assert!(res.certs.iter().any(|c| c.domain == "listtest.example.com"));
    }

    #[tokio::test]
    async fn sync_domains_는_도메인별_인증서를_사전_발급한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .sync_domains(Request::new(SyncDomainsRequest {
                domains: vec![
                    TlsDomain { host: "a.example.com".to_string(), origin: "https://a.example.com".to_string() },
                    TlsDomain { host: "b.example.com".to_string(), origin: "https://b.example.com".to_string() },
                ],
            }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.success);
    }

    #[tokio::test]
    async fn health_는_online_true를_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .health(Request::new(HealthRequest {}))
            .await
            .unwrap()
            .into_inner();

        assert!(res.online);
    }
}
