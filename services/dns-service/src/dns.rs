/// DNS 서버 — UDP 포트 53에서 쿼리를 처리한다
/// 등록 도메인: CDN IP (A 레코드) 반환
/// 와일드카드 (*.example.com): 서브도메인 전체 매칭
/// 미등록 도메인: upstream DNS로 포워딩
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use hickory_proto::op::{Header, Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{Name, RData, Record, RecordType};
use hickory_proto::rr::rdata::A;
use hickory_proto::serialize::binary::{BinDecodable, BinDecoder, BinEncodable, BinEncoder};
use tokio::net::UdpSocket;

use crate::grpc::DomainMap;
use crate::metrics::{QueryEntry, QueryResult, SharedMetrics, SharedRecent};

/// DNS 서버 실행 — tokio task로 spawn하여 사용
pub async fn run_dns_server(
    domain_map: DomainMap,
    metrics: SharedMetrics,
    recent: SharedRecent,
    cdn_ip: Ipv4Addr,
    upstream: SocketAddr,
) {
    let socket = Arc::new(
        UdpSocket::bind("0.0.0.0:53")
            .await
            .expect("DNS 포트 53 바인딩 실패 (root 권한 또는 CAP_NET_BIND_SERVICE 필요)"),
    );
    tracing::info!("DNS 서버 시작 — UDP :53, CDN_IP={cdn_ip}, upstream={upstream}");
    run_dns_loop(socket, domain_map, metrics, recent, cdn_ip, upstream).await;
}

/// DNS 수신 루프 — 미리 바인딩된 소켓으로 쿼리를 처리한다 (테스트 가능)
pub(crate) async fn run_dns_loop(
    socket: Arc<UdpSocket>,
    domain_map: DomainMap,
    metrics: SharedMetrics,
    recent: SharedRecent,
    cdn_ip: Ipv4Addr,
    upstream: SocketAddr,
) {
    loop {
        let mut buf = [0u8; 512];
        let Ok((len, src)) = socket.recv_from(&mut buf).await else {
            continue;
        };
        let socket = socket.clone();
        let domain_map = domain_map.clone();
        let metrics = metrics.clone();
        let recent = recent.clone();
        let data = buf[..len].to_vec();

        tokio::spawn(async move {
            if let Err(e) = handle_dns_query(
                &data, src, &socket, &domain_map, &metrics, &recent, cdn_ip, upstream,
            )
            .await
            {
                tracing::warn!("DNS 쿼리 처리 오류: {e}");
            }
        });
    }
}

/// 단일 쿼리 결과를 분류하는 순수 함수.
/// - qtype이 A이고 도메인 맵에 매칭되면 Matched
/// - 그 외에는 upstream 포워딩 결과(성공/실패)에 따라 Forwarded / Nxdomain
/// upstream_ok는 비-A 쿼리일 때도 Some(bool)이어야 하며, A 쿼리지만 매칭 실패 시에도 동일하다.
pub(crate) fn classify(qtype_is_a: bool, map_hit: bool, upstream_ok: Option<bool>) -> QueryResult {
    if qtype_is_a && map_hit {
        return QueryResult::Matched;
    }
    match upstream_ok {
        Some(true) => QueryResult::Forwarded,
        _ => QueryResult::Nxdomain,
    }
}

/// 메트릭 + 최근 쿼리 링버퍼에 결과를 1회만 기록
fn log_query(
    metrics: &SharedMetrics,
    recent: &SharedRecent,
    ts_ms: i64,
    client_ip: std::net::IpAddr,
    qname: &str,
    qtype: &str,
    result: QueryResult,
    start: Instant,
) {
    metrics.record(result);
    recent.push(QueryEntry {
        ts_unix_ms: ts_ms,
        client_ip: client_ip.to_string(),
        qname: qname.trim_end_matches('.').to_string(),
        qtype: qtype.to_string(),
        result,
        latency_us: start.elapsed().as_micros().min(u32::MAX as u128) as u32,
    });
}

/// DNS 쿼리 파싱 → 응답 생성/전송
#[allow(clippy::too_many_arguments)]
async fn handle_dns_query(
    buf: &[u8],
    src: SocketAddr,
    socket: &UdpSocket,
    domain_map: &DomainMap,
    metrics: &SharedMetrics,
    recent: &SharedRecent,
    cdn_ip: Ipv4Addr,
    upstream: SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let start = Instant::now();
    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut decoder = BinDecoder::new(buf);
    let query = match Message::read(&mut decoder) {
        Ok(q) => q,
        Err(e) => {
            // 디코드 실패: qname/qtype 미상 → Nxdomain으로 기록 후 오류 전파
            log_query(metrics, recent, ts_ms, src.ip(), "", "?", QueryResult::Nxdomain, start);
            return Err(Box::new(e));
        }
    };

    // qname/qtype 추출 — 쿼리가 없으면 빈 문자열 + "?" 로 기록
    // qtype은 Display(to_string)를 사용해 "A"/"AAAA" 등 표준 문자열로 기록 (Unknown(NN) Debug 출력 방지)
    let (qname_for_log, qtype_for_log, first_q) = match query.queries().first() {
        Some(q) => (
            q.name().to_string(),
            q.query_type().to_string(),
            Some(q.clone()),
        ),
        None => (String::new(), "?".to_string(), None),
    };

    // A 쿼리가 아니면 곧바로 upstream 포워딩
    let q = match first_q {
        Some(q) if q.query_type() == RecordType::A => q,
        _ => {
            let fwd_ok = forward_to_upstream(buf, src, socket, upstream).await.is_ok();
            let result = classify(false, false, Some(fwd_ok));
            log_query(metrics, recent, ts_ms, src.ip(), &qname_for_log, &qtype_for_log, result, start);
            return if fwd_ok { Ok(()) } else { Err("upstream forward 실패".into()) };
        }
    };

    let name_str = q.name().to_string();
    let host = name_str.trim_end_matches('.');

    let registered = {
        let map = domain_map.read().await;
        is_domain_registered(&map, host)
    };

    if registered {
        // A 매칭 — CDN IP 응답
        // 인코드/송신 실패 시에도 log_query는 반드시 1회 호출되어야 하므로 async block으로 묶는다.
        // 로컬 실패는 Nxdomain으로 기록하고 원래 에러를 그대로 전파한다.
        let send_outcome: Result<(), Box<dyn std::error::Error + Send + Sync>> = async {
            let response = build_a_response(&query, q.name().clone(), cdn_ip)?;
            let mut out = Vec::with_capacity(512);
            let mut encoder = BinEncoder::new(&mut out);
            response.emit(&mut encoder)?;
            socket.send_to(&out, src).await?;
            Ok(())
        }
        .await;

        let result = if send_outcome.is_ok() {
            tracing::debug!(host = %host, ip = %cdn_ip, "DNS: CDN IP 반환");
            classify(true, true, None)
        } else {
            // 로컬 encode/send 실패도 Nxdomain으로 기록
            QueryResult::Nxdomain
        };
        log_query(metrics, recent, ts_ms, src.ip(), &qname_for_log, &qtype_for_log, result, start);
        send_outcome?;
        Ok(())
    } else {
        // 미등록 — upstream 포워딩
        let fwd_ok = forward_to_upstream(buf, src, socket, upstream).await.is_ok();
        tracing::debug!(host = %host, upstream = %upstream, ok = fwd_ok, "DNS: upstream 포워딩");
        let result = classify(true, false, Some(fwd_ok));
        log_query(metrics, recent, ts_ms, src.ip(), &qname_for_log, &qtype_for_log, result, start);
        if fwd_ok { Ok(()) } else { Err("upstream forward 실패".into()) }
    }
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
    header.set_recursion_available(true);
    header.set_recursion_desired(query.header().recursion_desired());
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

    let mut resp_buf = [0u8; 4096];
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
    use crate::metrics::{DnsMetrics, RecentQueries};

    fn make_map(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// 테스트용 throwaway 메트릭/링버퍼 쌍 생성
    fn make_state() -> (SharedMetrics, SharedRecent) {
        (Arc::new(DnsMetrics::new()), Arc::new(RecentQueries::new(512)))
    }

    // ── classify 분류 헬퍼 단위 테스트 ───────────────────────────────

    #[test]
    fn classify_a_쿼리_매칭은_matched() {
        assert_eq!(classify(true, true, None), QueryResult::Matched);
    }

    #[test]
    fn classify_upstream_성공은_forwarded() {
        // A 쿼리지만 매칭 실패 + upstream 성공
        assert_eq!(classify(true, false, Some(true)), QueryResult::Forwarded);
        // 비-A 쿼리 + upstream 성공
        assert_eq!(classify(false, false, Some(true)), QueryResult::Forwarded);
    }

    #[test]
    fn classify_upstream_실패는_nxdomain() {
        // A 매칭 실패 + upstream 실패
        assert_eq!(classify(true, false, Some(false)), QueryResult::Nxdomain);
        // 비-A 쿼리 + upstream 실패
        assert_eq!(classify(false, false, Some(false)), QueryResult::Nxdomain);
        // upstream_ok가 None(측정 전)이고 매칭도 없으면 Nxdomain
        assert_eq!(classify(false, false, None), QueryResult::Nxdomain);
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

    /// 다단계 서브도메인(a.b.textbook.com)은 *.textbook.com에 매칭되지 않는다.
    /// 현재 구현은 첫 번째 레이블만 제거하므로 *.b.textbook.com만 확인한다.
    #[test]
    fn 다단계_서브도메인은_첫번째_레이블_기준_와일드카드만_매칭한다() {
        let map = make_map(&[("*.textbook.com", "https://textbook.com")]);
        // a.b.textbook.com → 첫 레이블 제거 → *.b.textbook.com → 미등록 → false
        assert!(!is_domain_registered(&map, "a.b.textbook.com"));
        // *.b.textbook.com을 직접 등록하면 매칭됨
        let map2 = make_map(&[("*.b.textbook.com", "https://textbook.com")]);
        assert!(is_domain_registered(&map2, "a.b.textbook.com"));
    }

    /// 점(.)이 없는 단일 레이블 호스트(localhost)는 false를 반환한다.
    #[test]
    fn 단일_레이블_호스트는_false를_반환한다() {
        let map = make_map(&[]);
        assert!(!is_domain_registered(&map, "localhost"));
    }

    /// build_a_response: TTL=300, A 레코드 IP, 응답 ID가 쿼리 ID와 일치한다.
    #[test]
    fn build_a_response_는_ttl_300_과_올바른_ip를_반환한다() {
        use hickory_proto::op::{Message, Query};
        use hickory_proto::rr::RecordType;
        use std::str::FromStr;

        let mut query = Message::new();
        query.set_id(42);
        let name = hickory_proto::rr::Name::from_str("textbook.com.").unwrap();
        let mut q = Query::new();
        q.set_name(name.clone());
        q.set_query_type(RecordType::A);
        query.add_query(q);

        let ip: Ipv4Addr = "1.2.3.4".parse().unwrap();
        let response = build_a_response(&query, name, ip).unwrap();

        // 응답 ID는 쿼리 ID와 동일해야 한다
        assert_eq!(response.header().id(), 42);
        // RA 플래그가 설정되어야 한다
        assert!(response.header().recursion_available());
        // A 레코드가 1개 있어야 한다
        assert_eq!(response.answers().len(), 1);
        let answer = &response.answers()[0];
        assert_eq!(answer.ttl(), 300);
        if let hickory_proto::rr::RData::A(a) = answer.data() {
            assert_eq!(a.0, ip);
        } else {
            panic!("A 레코드가 아닙니다");
        }
    }

    use tokio::sync::RwLock;

    // ── A 쿼리 메시지 직렬화 헬퍼 ────────────────────────────────────
    fn make_a_query(id: u16, name_str: &str) -> Vec<u8> {
        use hickory_proto::op::{Message, MessageType, OpCode, Query};
        use hickory_proto::rr::{Name, RecordType};
        use hickory_proto::serialize::binary::BinEncodable;
        use std::str::FromStr;

        let mut msg = Message::new();
        msg.set_id(id);
        msg.set_message_type(MessageType::Query);
        msg.set_op_code(OpCode::Query);
        msg.set_recursion_desired(true);
        let name = Name::from_str(name_str).unwrap();
        let mut q = Query::new();
        q.set_name(name);
        q.set_query_type(RecordType::A);
        msg.add_query(q);
        let mut buf = Vec::new();
        let mut encoder = BinEncoder::new(&mut buf);
        msg.emit(&mut encoder).unwrap();
        buf
    }

    // ── AAAA 쿼리 메시지 직렬화 헬퍼 ─────────────────────────────────
    fn make_aaaa_query(id: u16, name_str: &str) -> Vec<u8> {
        use hickory_proto::op::{Message, MessageType, OpCode, Query};
        use hickory_proto::rr::{Name, RecordType};
        use hickory_proto::serialize::binary::BinEncodable;
        use std::str::FromStr;

        let mut msg = Message::new();
        msg.set_id(id);
        msg.set_message_type(MessageType::Query);
        msg.set_op_code(OpCode::Query);
        msg.set_recursion_desired(true);
        let name = Name::from_str(name_str).unwrap();
        let mut q = Query::new();
        q.set_name(name);
        q.set_query_type(RecordType::AAAA);
        msg.add_query(q);
        let mut buf = Vec::new();
        let mut encoder = BinEncoder::new(&mut buf);
        msg.emit(&mut encoder).unwrap();
        buf
    }

    /// handle_dns_query: 등록 도메인 A 쿼리 → CDN IP가 담긴 응답을 반환한다
    #[tokio::test]
    async fn handle_dns_query_등록_도메인은_cdn_ip를_반환한다() {
        // 서버 소켓 (응답 수신용), 클라이언트 소켓 (응답 돌려받을 주소 역할)
        let server_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_addr = client_sock.local_addr().unwrap();

        let cdn_ip: Ipv4Addr = "10.0.0.1".parse().unwrap();
        let upstream: SocketAddr = "127.0.0.1:1".parse().unwrap(); // 미사용

        // 도메인 맵에 textbook.com 등록
        let mut map_inner = HashMap::new();
        map_inner.insert("textbook.com".to_string(), "https://textbook.com".to_string());
        let domain_map: DomainMap = Arc::new(RwLock::new(map_inner));

        let buf = make_a_query(7, "textbook.com.");

        // handle_dns_query 직접 호출 — src=client_addr 로 응답 전송
        let (metrics, recent) = make_state();
        handle_dns_query(
            &buf, client_addr, &server_sock, &domain_map, &metrics, &recent, cdn_ip, upstream,
        )
        .await
        .unwrap();

        // Matched 1건이 기록되어야 한다
        let snap = metrics.snapshot();
        assert_eq!(snap.total, 1);
        assert_eq!(snap.matched, 1);
        assert_eq!(recent.snapshot(10).len(), 1);

        // 클라이언트 소켓에서 응답 수신
        let mut resp = [0u8; 512];
        let (len, _) = client_sock.recv_from(&mut resp).await.unwrap();

        // 응답 파싱
        let mut dec = BinDecoder::new(&resp[..len]);
        let msg = Message::read(&mut dec).unwrap();

        // A 레코드 1개, CDN IP와 일치해야 한다
        assert_eq!(msg.answers().len(), 1);
        if let RData::A(a) = msg.answers()[0].data() {
            assert_eq!(a.0, cdn_ip);
        } else {
            panic!("A 레코드가 아닙니다");
        }
        assert_eq!(msg.header().id(), 7);
    }

    /// handle_dns_query: 미등록 도메인 → mock upstream으로 포워딩하고 응답을 돌려준다
    #[tokio::test]
    async fn handle_dns_query_미등록_도메인은_upstream에_포워딩된다() {
        // mock upstream: 쿼리를 받으면 동일 바이트를 그대로 돌려주는 에코 서버
        let upstream_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream_sock.local_addr().unwrap();

        tokio::spawn(async move {
            let mut buf = [0u8; 512];
            if let Ok((len, src)) = upstream_sock.recv_from(&mut buf).await {
                // 에코: 받은 바이트 그대로 돌려줌
                let _ = upstream_sock.send_to(&buf[..len], src).await;
            }
        });

        let server_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_addr = client_sock.local_addr().unwrap();

        let cdn_ip: Ipv4Addr = "10.0.0.1".parse().unwrap();
        // 빈 맵 — unknown.com 미등록
        let domain_map: DomainMap = Arc::new(RwLock::new(HashMap::new()));

        let buf = make_a_query(99, "unknown.com.");

        let (metrics, recent) = make_state();
        handle_dns_query(
            &buf, client_addr, &server_sock, &domain_map, &metrics, &recent, cdn_ip, upstream_addr,
        )
        .await
        .unwrap();

        // Forwarded 1건이 기록되어야 한다
        let snap = metrics.snapshot();
        assert_eq!(snap.total, 1);
        assert_eq!(snap.forwarded, 1);

        // 클라이언트에서 응답 수신 (에코이므로 쿼리와 동일)
        let mut resp = [0u8; 512];
        client_sock
            .recv_from(&mut resp)
            .await
            .unwrap();
        // 응답이 도착했으면 포워딩 성공
    }

    /// handle_dns_query: non-A 쿼리(AAAA) → upstream으로 포워딩된다
    #[tokio::test]
    async fn handle_dns_query_non_a_쿼리는_upstream에_포워딩된다() {
        // mock upstream 에코 서버
        let upstream_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream_sock.local_addr().unwrap();

        tokio::spawn(async move {
            let mut buf = [0u8; 512];
            if let Ok((len, src)) = upstream_sock.recv_from(&mut buf).await {
                let _ = upstream_sock.send_to(&buf[..len], src).await;
            }
        });

        let server_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_addr = client_sock.local_addr().unwrap();

        let cdn_ip: Ipv4Addr = "10.0.0.1".parse().unwrap();
        // textbook.com은 등록되어 있지만 AAAA 쿼리는 upstream으로 가야 한다
        let mut map_inner = HashMap::new();
        map_inner.insert("textbook.com".to_string(), "https://textbook.com".to_string());
        let domain_map: DomainMap = Arc::new(RwLock::new(map_inner));

        // AAAA 쿼리 생성
        let buf = make_aaaa_query(55, "textbook.com.");

        let (metrics, recent) = make_state();
        handle_dns_query(
            &buf, client_addr, &server_sock, &domain_map, &metrics, &recent, cdn_ip, upstream_addr,
        )
        .await
        .unwrap();

        // 비-A 쿼리도 포워딩 성공 → Forwarded 1건
        let snap = metrics.snapshot();
        assert_eq!(snap.total, 1);
        assert_eq!(snap.forwarded, 1);
        let _ = recent.snapshot(1);

        let mut resp = [0u8; 512];
        client_sock.recv_from(&mut resp).await.unwrap();
        // 에코 응답이 도착하면 포워딩 성공
    }

    /// run_dns_loop: 등록 도메인 A 쿼리를 처리하고 CDN IP 응답을 반환한다
    #[tokio::test]
    async fn run_dns_loop_은_등록_도메인_쿼리에_응답한다() {
        let server_sock = Arc::new(UdpSocket::bind("127.0.0.1:0").await.unwrap());
        let server_addr = server_sock.local_addr().unwrap();

        let client_sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let client_addr = client_sock.local_addr().unwrap();

        let cdn_ip: Ipv4Addr = "10.0.0.1".parse().unwrap();
        let mut map_inner = HashMap::new();
        map_inner.insert("textbook.com".to_string(), "https://textbook.com".to_string());
        let domain_map: DomainMap = Arc::new(RwLock::new(map_inner));
        // upstream은 사용되지 않음 (등록 도메인 쿼리)
        let upstream: SocketAddr = "127.0.0.1:1".parse().unwrap();

        let loop_sock = server_sock.clone();
        let loop_map = domain_map.clone();
        let (metrics, recent) = make_state();
        let loop_metrics = metrics.clone();
        let loop_recent = recent.clone();
        let loop_handle = tokio::spawn(async move {
            run_dns_loop(loop_sock, loop_map, loop_metrics, loop_recent, cdn_ip, upstream).await;
        });

        // 등록 도메인 A 쿼리 전송
        let buf = make_a_query(1, "textbook.com.");
        client_sock.send_to(&buf, server_addr).await.unwrap();

        // 응답 수신 (CDN IP 반환)
        let mut resp = [0u8; 512];
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            client_sock.recv_from(&mut resp),
        ).await;
        loop_handle.abort();

        assert!(result.is_ok(), "run_dns_loop이 A 쿼리에 응답해야 한다");
        let (len, _) = result.unwrap().unwrap();
        // 응답 파싱 — CDN IP가 포함되어야 한다
        let mut decoder = BinDecoder::new(&resp[..len]);
        let response = Message::read(&mut decoder).unwrap();
        assert!(response.header().message_type() == MessageType::Response);
        let answer = &response.answers()[0];
        if let RData::A(a) = answer.data() {
            assert_eq!(a.0, cdn_ip);
        } else {
            panic!("A 레코드가 아닙니다");
        }
    }
}
