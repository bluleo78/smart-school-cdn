/// origin-바운드 HTTP 클라이언트 팩토리
///
/// 기본 reqwest 의 redirect 정책은 10회 자동 follow 지만, CDN 은 redirect 를 iPad 가
/// 직접 따라가도록 3xx 응답을 투명 패스스루 한다(`Policy::none()`).
/// - 캐시 키의 일관성 유지 (A → B 자동 follow 시 A 키에 B 본문이 저장되는 오염 방지)
/// - Location 헤더를 그대로 iPad 에 전달해 브라우저가 새 주소를 스스로 해석

/// origin 서버 호출용 reqwest::Client 를 만든다 — redirect 자동 follow 비활성.
pub fn make_origin_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
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
