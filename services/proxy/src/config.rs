/// 프록시 대상 도메인 → 원본 서버 매핑 설정
/// Phase 4에서 Admin Dashboard를 통한 동적 관리로 전환 예정
use std::collections::HashMap;

/// 프록시 대상 도메인과 원본 서버 주소를 관리하는 설정
pub struct ProxyConfig {
    /// 도메인 → 원본 서버 URL 매핑 (예: "httpbin.org" → "https://httpbin.org")
    domains: HashMap<String, String>,
}

impl ProxyConfig {
    /// 기본 설정 생성 — 개발/테스트용 도메인 포함
    pub fn default_config() -> Self {
        let mut domains = HashMap::new();
        // 개발/테스트용: httpbin.org를 프록시 대상으로 등록
        domains.insert("httpbin.org".to_string(), "https://httpbin.org".to_string());
        Self { domains }
    }

    /// 임의의 도메인 매핑으로 설정 생성 — 통합 테스트에서 mock 원본 서버를 주입할 때 사용
    pub fn with_domains(domains: HashMap<String, String>) -> Self {
        Self { domains }
    }

    /// 도메인에 대응하는 원본 서버 URL 조회
    /// 미등록 도메인이면 None 반환
    pub fn get_origin(&self, host: &str) -> Option<&str> {
        // Host 헤더에 포트가 포함된 경우 제거 (예: "httpbin.org:8080" → "httpbin.org")
        let domain = host.split(':').next().unwrap_or(host);
        self.domains.get(domain).map(|s| s.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 등록된_도메인은_원본_서버_주소를_반환한다() {
        let config = ProxyConfig::default_config();
        assert_eq!(
            config.get_origin("httpbin.org"),
            Some("https://httpbin.org")
        );
    }

    #[test]
    fn 포트가_포함된_호스트에서도_도메인을_정상_추출한다() {
        let config = ProxyConfig::default_config();
        assert_eq!(
            config.get_origin("httpbin.org:8080"),
            Some("https://httpbin.org")
        );
    }

    #[test]
    fn 미등록_도메인은_none을_반환한다() {
        let config = ProxyConfig::default_config();
        assert_eq!(config.get_origin("unknown.com"), None);
    }
}
