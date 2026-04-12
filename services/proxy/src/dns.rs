/// DNS 서버 — UDP 포트 53에서 쿼리를 처리한다
/// 등록 도메인: CDN IP (A 레코드) 반환
/// 와일드카드 (*.example.com): 서브도메인 전체 매칭
/// 미등록 도메인: upstream DNS로 포워딩
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use hickory_proto::op::{Header, Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{Name, RData, Record, RecordType};
use hickory_proto::rr::rdata::A;
use hickory_proto::serialize::binary::{BinDecodable, BinDecoder, BinEncodable, BinEncoder};
use tokio::net::UdpSocket;

use crate::DomainMap;

/// DNS 서버 실행 — tokio task로 spawn하여 사용
pub async fn run_dns_server(domain_map: DomainMap, cdn_ip: Ipv4Addr, upstream: SocketAddr) {
    let socket = Arc::new(
        UdpSocket::bind("0.0.0.0:53")
            .await
            .expect("DNS 포트 53 바인딩 실패 (root 권한 또는 CAP_NET_BIND_SERVICE 필요)"),
    );
    tracing::info!("DNS 서버 시작 — UDP :53, CDN_IP={cdn_ip}, upstream={upstream}");

    loop {
        let mut buf = [0u8; 512];
        let Ok((len, src)) = socket.recv_from(&mut buf).await else {
            continue;
        };
        let socket = socket.clone();
        let domain_map = domain_map.clone();
        let data = buf[..len].to_vec();

        tokio::spawn(async move {
            if let Err(e) =
                handle_dns_query(&data, src, &socket, &domain_map, cdn_ip, upstream).await
            {
                tracing::warn!("DNS 쿼리 처리 오류: {e}");
            }
        });
    }
}

/// DNS 쿼리 파싱 → 응답 생성/전송
async fn handle_dns_query(
    buf: &[u8],
    src: SocketAddr,
    socket: &UdpSocket,
    domain_map: &DomainMap,
    cdn_ip: Ipv4Addr,
    upstream: SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut decoder = BinDecoder::new(buf);
    let query = Message::read(&mut decoder)?;

    let q: hickory_proto::op::Query = match query.queries().first() {
        Some(q) if q.query_type() == RecordType::A => q.clone(),
        _ => return forward_to_upstream(buf, src, socket, upstream).await,
    };

    let name_str = q.name().to_string();
    let host = name_str.trim_end_matches('.');

    let registered = {
        let map = domain_map.read().await;
        is_domain_registered(&map, host)
    };

    if registered {
        let response = build_a_response(&query, q.name().clone(), cdn_ip)?;
        let mut out = Vec::with_capacity(512);
        let mut encoder = BinEncoder::new(&mut out);
        response.emit(&mut encoder)?;
        socket.send_to(&out, src).await?;
        tracing::debug!(host = %host, ip = %cdn_ip, "DNS: CDN IP 반환");
    } else {
        forward_to_upstream(buf, src, socket, upstream).await?;
        tracing::debug!(host = %host, upstream = %upstream, "DNS: upstream 포워딩");
    }
    Ok(())
}

/// 등록된 도메인 여부 확인 (와일드카드 포함)
/// *.example.com 등록 시 sub.example.com 쿼리에 매칭
pub fn is_domain_registered(map: &HashMap<String, String>, host: &str) -> bool {
    if map.contains_key(host) {
        return true;
    }
    // 와일드카드: 첫 번째 레이블 이후 부모 도메인에 *. 등록 여부 확인
    if let Some(dot_pos) = host.find('.') {
        let wildcard = format!("*.{}", &host[dot_pos + 1..]);
        if map.contains_key(&wildcard) {
            return true;
        }
    }
    false
}

/// A 레코드 응답 메시지 빌드
fn build_a_response(
    query: &Message,
    name: Name,
    ip: Ipv4Addr,
) -> Result<Message, Box<dyn std::error::Error + Send + Sync>> {
    let mut response = Message::new();
    let mut header = Header::new();
    header.set_id(query.header().id());
    header.set_message_type(MessageType::Response);
    header.set_op_code(OpCode::Query);
    header.set_authoritative(true);
    header.set_response_code(ResponseCode::NoError);
    response.set_header(header);

    for q in query.queries() {
        response.add_query(q.clone());
    }

    let record = Record::from_rdata(name, 300, RData::A(A(ip)));
    response.add_answer(record);
    Ok(response)
}

/// DNS 쿼리를 upstream으로 포워딩하고 응답을 src로 전달 (타임아웃 3초)
async fn forward_to_upstream(
    buf: &[u8],
    src: SocketAddr,
    socket: &UdpSocket,
    upstream: SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let us = UdpSocket::bind("0.0.0.0:0").await?;
    us.send_to(buf, upstream).await?;

    let mut resp_buf = [0u8; 512];
    let (len, _) = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        us.recv_from(&mut resp_buf),
    )
    .await??;

    socket.send_to(&resp_buf[..len], src).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_map(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn 등록된_도메인은_true를_반환한다() {
        let map = make_map(&[("textbook.com", "https://textbook.com")]);
        assert!(is_domain_registered(&map, "textbook.com"));
    }

    #[test]
    fn 미등록_도메인은_false를_반환한다() {
        let map = make_map(&[]);
        assert!(!is_domain_registered(&map, "unknown.com"));
    }

    #[test]
    fn 와일드카드_등록_시_서브도메인이_매칭된다() {
        let map = make_map(&[("*.textbook.com", "https://textbook.com")]);
        assert!(is_domain_registered(&map, "cdn.textbook.com"));
        assert!(is_domain_registered(&map, "auth.textbook.com"));
    }

    #[test]
    fn 와일드카드는_루트_도메인을_매칭하지_않는다() {
        let map = make_map(&[("*.textbook.com", "https://textbook.com")]);
        assert!(!is_domain_registered(&map, "textbook.com"));
    }

    #[test]
    fn 와일드카드는_다른_도메인에_매칭하지_않는다() {
        let map = make_map(&[("*.textbook.com", "https://textbook.com")]);
        assert!(!is_domain_registered(&map, "cdn.otherdomain.com"));
    }
}
