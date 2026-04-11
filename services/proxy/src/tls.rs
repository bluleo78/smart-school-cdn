/// TLS 관리 모듈
/// - CA 키·인증서를 파일 시스템에 영속화 (certs_dir/ca.key, ca.crt)
/// - 도메인별 서버 인증서를 온디맨드 발급 후 메모리 캐시
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair};
use time::{Duration, OffsetDateTime};

/// CA 서명으로 발급된 도메인 인증서 캐시 항목
pub struct CachedCert {
    pub domain: String,
    pub cert_pem: String,
    pub key_pem: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// 관리 API 응답용 인증서 정보
#[derive(serde::Serialize)]
pub struct CertInfo {
    pub domain: String,
    pub issued_at: String,
    pub expires_at: String,
}

/// TLS 관리자 — CA 생성/로드 + 도메인 인증서 온디맨드 발급
pub struct TlsManager {
    /// CA 키쌍 (도메인 인증서 서명용)
    ca_key: KeyPair,
    /// CA 인증서 (서명 시 issuer 정보 제공용, 시작마다 ca_key로 재생성)
    ca_cert: rcgen::Certificate,
    /// 다운로드 제공용 CA PEM (파일에서 읽은 원본)
    pub ca_cert_pem: String,
    /// 발급된 도메인 인증서 메모리 캐시
    cert_cache: Mutex<HashMap<String, Arc<CachedCert>>>,
}

impl TlsManager {
    /// certs_dir에 CA 파일이 있으면 로드, 없으면 생성 후 저장
    pub fn load_or_create(certs_dir: &Path) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let key_path = certs_dir.join("ca.key");
        let cert_path = certs_dir.join("ca.crt");

        let (ca_key, ca_cert, ca_cert_pem) = if key_path.exists() && cert_path.exists() {
            tracing::info!("기존 CA 인증서 로드: {:?}", certs_dir);
            let key_pem = std::fs::read_to_string(&key_path)?;
            let ca_cert_pem = std::fs::read_to_string(&cert_path)?;
            let ca_key = KeyPair::from_pem(&key_pem)?;
            // 같은 키로 재생성 — AKI(Authority Key Identifier)가 동일하므로 도메인 인증서 신뢰 유지
            let ca_cert = Self::ca_params().self_signed(&ca_key)?;
            (ca_key, ca_cert, ca_cert_pem)
        } else {
            tracing::info!("새 CA 인증서 생성: {:?}", certs_dir);
            std::fs::create_dir_all(certs_dir)?;
            let ca_key = KeyPair::generate()?;
            let ca_cert = Self::ca_params().self_signed(&ca_key)?;
            let ca_cert_pem = ca_cert.pem();
            let ca_key_pem = ca_key.serialize_pem();
            std::fs::write(&key_path, &ca_key_pem)?;
            std::fs::write(&cert_path, &ca_cert_pem)?;
            (ca_key, ca_cert, ca_cert_pem)
        };

        Ok(Arc::new(Self {
            ca_key,
            ca_cert,
            ca_cert_pem,
            cert_cache: Mutex::new(HashMap::new()),
        }))
    }

    /// CA CertificateParams 생성 (유효기간 10년)
    fn ca_params() -> CertificateParams {
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.distinguished_name.push(DnType::CommonName, "Smart School CDN CA");
        params.not_after = OffsetDateTime::now_utc()
            .checked_add(Duration::days(3650))
            .expect("날짜 계산 실패");
        params
    }

    /// 도메인 인증서 조회 (캐시 HIT) 또는 온디맨드 발급 (캐시 MISS)
    pub fn get_or_issue(&self, domain: &str) -> Arc<CachedCert> {
        // 캐시 HIT 확인
        {
            let cache = self.cert_cache.lock().unwrap();
            if let Some(cached) = cache.get(domain) {
                if cached.expires_at > Utc::now() {
                    return Arc::clone(cached);
                }
            }
        }

        // 캐시 MISS → 신규 발급
        let cert = self.issue_domain_cert(domain);
        let cert = Arc::new(cert);
        {
            let mut cache = self.cert_cache.lock().unwrap();
            cache.insert(domain.to_string(), Arc::clone(&cert));
        }
        tracing::info!(domain = %domain, "도메인 인증서 발급 완료");
        cert
    }

    /// CA 서명으로 도메인 인증서 발급 (유효기간 30일)
    fn issue_domain_cert(&self, domain: &str) -> CachedCert {
        let domain_key = KeyPair::generate().expect("도메인 키 생성 실패");
        let expires_offset = OffsetDateTime::now_utc()
            .checked_add(Duration::days(30))
            .expect("날짜 계산 실패");

        let mut params = CertificateParams::new(vec![domain.to_string()])
            .expect("SAN 설정 실패");
        params.distinguished_name.push(DnType::CommonName, domain);
        params.not_after = expires_offset;

        let domain_cert = params
            .signed_by(&domain_key, &self.ca_cert, &self.ca_key)
            .expect("도메인 인증서 서명 실패");

        let issued_at = Utc::now();
        let expires_at = issued_at + chrono::Duration::days(30);

        CachedCert {
            domain: domain.to_string(),
            cert_pem: domain_cert.pem(),
            key_pem: domain_key.serialize_pem(),
            issued_at,
            expires_at,
        }
    }

    /// 관리 API용: 현재 캐시된 인증서 목록 반환
    pub fn list_certificates(&self) -> Vec<CertInfo> {
        let cache = self.cert_cache.lock().unwrap();
        cache
            .values()
            .map(|c| CertInfo {
                domain: c.domain.clone(),
                issued_at: c.issued_at.to_rfc3339(),
                expires_at: c.expires_at.to_rfc3339(),
            })
            .collect()
    }
}
