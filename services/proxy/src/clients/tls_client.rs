/// TLS gRPC 클라이언트 — tls-service:50052 통신
/// SNI 핸들러는 sync 함수이므로 로컬 cert_cache에서 조회한다.
/// 도메인 sync 시 prefetch_cert()로 미리 발급해 로컬 캐시에 저장한다.
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use rustls::sign::CertifiedKey;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls_pemfile::{certs, private_key};
use tonic::transport::Channel;

use cdn_proto::tls::{
    tls_service_client::TlsServiceClient,
    CertRequest, Empty,
};

/// SNI 핸들러에서 공유하는 로컬 인증서 캐시
pub type CertCache = Arc<Mutex<HashMap<String, Arc<CertifiedKey>>>>;

pub struct TlsClient {
    inner:          TlsServiceClient<Channel>,
    pub cert_cache: CertCache,
    pub ca_cert_pem: String,
}

impl TlsClient {
    pub async fn connect(url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let ch = tonic::transport::Channel::from_shared(url.to_string())?
            .connect()
            .await?;
        let mut inner = TlsServiceClient::new(ch);
        // 시작 시 CA 인증서 로드
        let ca_pem = inner.get_ca_cert(Empty {}).await?.into_inner().cert_pem;
        Ok(Self {
            inner,
            cert_cache: Arc::new(Mutex::new(HashMap::new())),
            ca_cert_pem: ca_pem,
        })
    }

    /// 도메인 인증서를 tls-service에서 가져와 로컬 CertCache에 저장
    pub async fn prefetch_cert(&mut self, domain: &str) {
        let resp = match self.inner.get_or_issue_cert(CertRequest {
            domain: domain.to_string(),
        }).await {
            Ok(r) => r.into_inner(),
            Err(e) => {
                tracing::warn!("인증서 prefetch 실패 {}: {}", domain, e);
                return;
            }
        };
        match pem_to_certified_key(&resp.cert_pem, &resp.key_pem) {
            Ok(ck) => {
                self.cert_cache.lock().await.insert(domain.to_string(), Arc::new(ck));
                tracing::debug!("인증서 캐시 갱신: {}", domain);
            }
            Err(e) => tracing::warn!("CertifiedKey 변환 실패 {}: {}", domain, e),
        }
    }

    /// CA 인증서 PEM (mobileconfig 생성용)
    pub fn get_ca_cert_pem(&self) -> String {
        self.ca_cert_pem.clone()
    }

    /// 발급 인증서 목록
    pub async fn list_certificates(&mut self) -> Vec<cdn_proto::tls::CertInfo> {
        self.inner.list_certificates(Empty {}).await
            .map(|r| r.into_inner().certs)
            .unwrap_or_default()
    }
}

/// PEM 문자열 → rustls CertifiedKey 변환
fn pem_to_certified_key(
    cert_pem: &str,
    key_pem: &str,
) -> Result<CertifiedKey, Box<dyn std::error::Error + Send + Sync>> {
    let cert_der: Vec<CertificateDer<'static>> = certs(&mut cert_pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()?;
    let key: PrivateKeyDer<'static> = private_key(&mut key_pem.as_bytes())?
        .ok_or("개인 키 없음")?;
    let signing_key = rustls::crypto::ring::sign::any_supported_type(&key)?;
    Ok(CertifiedKey::new(cert_der, signing_key))
}
