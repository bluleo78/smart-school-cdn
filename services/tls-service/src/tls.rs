/// TLS 관리 모듈
/// - CA 키·인증서를 파일 시스템에 영속화 (certs_dir/ca.key, ca.crt)
/// - 도메인별 서버 인증서를 온디맨드 발급 후 메모리 캐시
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair};
use rustls::sign::CertifiedKey;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use time::{Duration, OffsetDateTime};

/// CA 서명으로 발급된 도메인 인증서 캐시 항목
/// CertifiedKey가 Serialize 미지원이므로 derive 생략 — API 응답은 CertInfo DTO 사용
pub struct CachedCert {
    pub domain: String,
    pub cert_pem: String,
    pub key_pem: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// 파싱 캐시 — 매 핸드셰이크마다 PEM 재파싱 방지
    pub certified_key: Arc<CertifiedKey>,
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
    ///
    /// TOCTOU 방지: 캐시 확인은 락 보유 중에, 발급은 락 밖에서 수행하고
    /// 저장 전 double-check으로 다른 스레드의 중복 발급을 방지한다.
    /// 발급 실패 시 None을 반환하여 해당 핸드셰이크만 거부한다.
    pub fn get_or_issue(&self, domain: &str) -> Option<Arc<CachedCert>> {
        // 캐시 HIT 확인 (락 보유 중)
        {
            let cache = self.cert_cache.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(cached) = cache.get(domain) {
                if cached.expires_at > Utc::now() {
                    return Some(Arc::clone(cached));
                }
            }
        }

        // 캐시 MISS → 발급 후 저장 (발급은 CPU 작업이므로 락 밖에서 수행)
        let cert = match self.issue_domain_cert(domain) {
            Ok(c) => Arc::new(c),
            Err(e) => {
                eprintln!("[TLS] 인증서 발급 실패 ({domain}): {e}");
                return None;
            }
        };
        {
            let mut cache = self.cert_cache.lock().unwrap_or_else(|e| e.into_inner());
            // double-check: 다른 스레드가 먼저 발급했을 수 있음
            if let Some(existing) = cache.get(domain) {
                if existing.expires_at > Utc::now() {
                    return Some(Arc::clone(existing));
                }
            }
            cache.insert(domain.to_string(), Arc::clone(&cert));
        }
        tracing::info!(domain = %domain, "도메인 인증서 발급 완료");
        Some(cert)
    }

    /// CA 서명으로 도메인 인증서 발급 (유효기간 30일)
    fn issue_domain_cert(&self, domain: &str) -> Result<CachedCert, Box<dyn std::error::Error>> {
        let domain_key = KeyPair::generate()?;
        let expires_offset = OffsetDateTime::now_utc()
            .checked_add(Duration::days(30))
            .expect("날짜 계산 실패"); // time 계산 실패는 실질적 불가 → expect 허용

        let mut params = CertificateParams::new(vec![domain.to_string()])?;
        params.distinguished_name.push(DnType::CommonName, domain);
        params.not_after = expires_offset;

        let domain_cert = params.signed_by(&domain_key, &self.ca_cert, &self.ca_key)?;

        let issued_at = Utc::now();
        let expires_at = issued_at + chrono::Duration::days(30);

        let cert_pem = domain_cert.pem();
        let key_pem = domain_key.serialize_pem();

        // PEM → CertifiedKey 변환하여 캐시 — 매 핸드셰이크마다 재파싱 방지
        let cert_der: Vec<CertificateDer<'static>> = rustls_pemfile::certs(
            &mut cert_pem.as_bytes()
        ).filter_map(|r| r.ok()).collect();
        let key_der: PrivateKeyDer<'static> = rustls_pemfile::private_key(&mut key_pem.as_bytes())
            .ok().flatten().expect("key parse");
        let signing_key = rustls::crypto::ring::sign::any_supported_type(&key_der)?;
        let certified_key = Arc::new(CertifiedKey::new(cert_der, signing_key));

        Ok(CachedCert {
            domain: domain.to_string(),
            cert_pem,
            key_pem,
            issued_at,
            expires_at,
            certified_key,
        })
    }

    /// 관리 API용: 현재 캐시된 인증서 목록 반환
    pub fn list_certificates(&self) -> Vec<CertInfo> {
        let cache = self.cert_cache.lock().unwrap_or_else(|e| e.into_inner());
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// CA 신규 생성 → PEM 비어있지 않음, 파일 생성 확인
    #[test]
    fn test_load_or_create_new() {
        let dir = TempDir::new().unwrap();
        let manager = TlsManager::load_or_create(dir.path()).unwrap();

        assert!(!manager.ca_cert_pem.is_empty());
        assert!(manager.ca_cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(dir.path().join("ca.key").exists());
        assert!(dir.path().join("ca.crt").exists());
    }

    /// 기존 CA 로드 → 같은 PEM 반환 (파일 내용 동일)
    #[test]
    fn test_load_or_create_existing() {
        let dir = TempDir::new().unwrap();
        let pem1 = {
            let m = TlsManager::load_or_create(dir.path()).unwrap();
            m.ca_cert_pem.clone()
        };
        let pem2 = {
            let m = TlsManager::load_or_create(dir.path()).unwrap();
            m.ca_cert_pem.clone()
        };
        assert_eq!(pem1, pem2);
    }

    /// 도메인 인증서 발급 → domain/cert_pem/key_pem/expires 확인
    #[test]
    fn test_get_or_issue() {
        let dir = TempDir::new().unwrap();
        let manager = TlsManager::load_or_create(dir.path()).unwrap();

        let cert = manager.get_or_issue("textbook.co.kr").expect("발급 성공");

        assert_eq!(cert.domain, "textbook.co.kr");
        assert!(cert.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(!cert.key_pem.is_empty());
        assert!(cert.expires_at > cert.issued_at);
    }

    /// 같은 도메인 재요청 → 캐시 HIT (동일 Arc 인스턴스)
    #[test]
    fn test_cert_cache_hit() {
        let dir = TempDir::new().unwrap();
        let manager = TlsManager::load_or_create(dir.path()).unwrap();

        let cert1 = manager.get_or_issue("test.example.com").expect("발급 성공");
        let cert2 = manager.get_or_issue("test.example.com").expect("캐시 HIT");

        assert!(Arc::ptr_eq(&cert1, &cert2));
    }

    /// 발급 후 목록에 포함 확인
    #[test]
    fn test_list_certificates() {
        let dir = TempDir::new().unwrap();
        let manager = TlsManager::load_or_create(dir.path()).unwrap();

        assert!(manager.list_certificates().is_empty());

        manager.get_or_issue("a.example.com").expect("발급 성공");
        manager.get_or_issue("b.example.com").expect("발급 성공");

        let list = manager.list_certificates();
        assert_eq!(list.len(), 2);
        let domains: Vec<&str> = list.iter().map(|c| c.domain.as_str()).collect();
        assert!(domains.contains(&"a.example.com"));
        assert!(domains.contains(&"b.example.com"));
    }
}
