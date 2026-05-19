/// origin-바운드 HTTP 클라이언트 팩토리
///
/// 기본 reqwest 의 redirect 정책은 10회 자동 follow 지만, CDN 은 redirect 를 iPad 가
/// 직접 따라가도록 3xx 응답을 투명 패스스루 한다(`Policy::none()`).
/// - 캐시 키의 일관성 유지 (A → B 자동 follow 시 A 키에 B 본문이 저장되는 오염 방지)
/// - Location 헤더를 그대로 iPad 에 전달해 브라우저가 새 주소를 스스로 해석
///
/// 이슈 #392 — reqwest 기본값을 그대로 쓰는 대신 학교 환경(학생 ~1000명 가정) 보수적 마진으로 명시.
/// 부하 테스트가 어려운 프로토타입 단계에서 안전한 default 값을 코드에 박아 운영 가시성을 높인다.

use std::time::Duration;

/// origin 서버 호출용 reqwest::Client 를 만든다.
/// - redirect 자동 follow 비활성
/// - pool_max_idle_per_host: 16 — origin 도메인 다양성에 비해 keepalive 보장 (#392)
/// - pool_idle_timeout: 90s — keepalive 유지 시간
/// - tcp_keepalive: 60s — NAT/idle 연결 끊김 방지
/// - connect_timeout: 5s — 다운된 origin 으로의 SYN 무한 대기 차단
/// - timeout: 30s — 단일 요청 상한 (대용량 본문 다운로드도 통과하도록 넉넉히)
pub fn make_origin_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(16)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest Client 생성 실패")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 팩토리 호출이 패닉 없이 클라이언트를 반환해야 한다 (단순 컴파일/호출 스모크)
    #[test]
    fn make_origin_http_client_is_constructible() {
        let _client = make_origin_http_client();
    }
}
