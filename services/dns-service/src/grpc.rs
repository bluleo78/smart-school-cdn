use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tonic::{Request, Response, Status};

use crate::metrics::{SharedMetrics, SharedRecent};
use cdn_proto::dns::{
    dns_service_server::DnsService,
    HealthRequest, HealthResponse,
    SyncDomainsRequest, SyncDomainsResponse,
    StatsRequest, StatsResponse,
    RecentQueriesRequest, RecentQueriesResponse,
    RecordsRequest, RecordsResponse,
    TopDomain,
    QueryEntry as ProtoQueryEntry,
    DnsRecord  as ProtoDnsRecord,
};

// DomainMap 타입 — dns.rs와 동일하게 유지
pub type DomainMap = Arc<RwLock<HashMap<String, String>>>;

pub struct DnsGrpc {
    pub(crate) domain_map: DomainMap,
    pub(crate) metrics:    SharedMetrics,
    pub(crate) recent:     SharedRecent,
    pub(crate) cdn_ip:     String,
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

    /// DNS 통계 조회 — 누적 카운터 + 상위 qname 10개 반환
    async fn get_stats(
        &self,
        _: Request<StatsRequest>,
    ) -> Result<Response<StatsResponse>, Status> {
        let snap = self.metrics.snapshot();
        let top_domains = self
            .recent
            .top_qnames(10)
            .into_iter()
            .map(|(qname, count)| TopDomain { qname, count })
            .collect();
        Ok(Response::new(StatsResponse {
            total_queries: snap.total,
            matched:       snap.matched,
            nxdomain:      snap.nxdomain,
            forwarded:     snap.forwarded,
            uptime_secs:   snap.uptime_secs,
            top_domains,
        }))
    }

    /// 최근 쿼리 목록 조회 — limit을 [1, 512]로 클램프
    async fn get_recent_queries(
        &self,
        req: Request<RecentQueriesRequest>,
    ) -> Result<Response<RecentQueriesResponse>, Status> {
        let raw = req.into_inner().limit;
        // clamp: 0 → 1, >512 → 512
        let limit = raw.clamp(1, 512) as usize;
        let entries = self
            .recent
            .snapshot(limit)
            .into_iter()
            .map(|e| ProtoQueryEntry {
                ts_unix_ms: e.ts_unix_ms,
                client_ip:  e.client_ip,
                qname:      e.qname,
                qtype:      e.qtype,
                result:     e.result.as_str().to_string(),
                latency_us: e.latency_us,
            })
            .collect();
        Ok(Response::new(RecentQueriesResponse { entries }))
    }

    /// DNS 레코드 목록 조회 — domain_map의 모든 호스트를 cdn_ip로 가는 A 레코드로 변환
    async fn get_records(
        &self,
        _: Request<RecordsRequest>,
    ) -> Result<Response<RecordsResponse>, Status> {
        let map = self.domain_map.read().await;
        let records = map
            .iter()
            .map(|(host, _origin)| ProtoDnsRecord {
                host:   host.clone(),
                target: self.cdn_ip.clone(),
                rtype:  "A".to_string(),
                source: "auto".to_string(),
            })
            .collect();
        Ok(Response::new(RecordsResponse { records }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Arc};
    use tokio::sync::RwLock;
    use tonic::Request;

    use crate::metrics::QueryResult;
    use cdn_proto::dns::{SyncDomainsRequest, HealthRequest, DnsDomain};

    /// 테스트용 DnsGrpc 인스턴스 생성
    fn make_grpc() -> DnsGrpc {
        DnsGrpc {
            domain_map: Arc::new(RwLock::new(HashMap::new())),
            metrics:    Arc::new(crate::metrics::DnsMetrics::new()),
            recent:     Arc::new(crate::metrics::RecentQueries::new(512)),
            cdn_ip:     "127.0.0.1".to_string(),
        }
    }

    #[tokio::test]
    async fn sync_domains_는_맵을_갱신한다() {
        let grpc = make_grpc();
        let res = grpc
            .sync_domains(Request::new(SyncDomainsRequest {
                domains: vec![
                    DnsDomain { host: "textbook.com".to_string(), origin: "https://textbook.com".to_string() },
                    DnsDomain { host: "cdn.edu.net".to_string(), origin: "https://cdn.edu.net".to_string() },
                ],
            }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.success);
        let map = grpc.domain_map.read().await;
        assert_eq!(map.get("textbook.com").map(String::as_str), Some("https://textbook.com"));
        assert_eq!(map.len(), 2);
    }

    #[tokio::test]
    async fn sync_domains_는_기존_맵을_교체한다() {
        let grpc = make_grpc();
        // 첫 sync: 2개
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![
                DnsDomain { host: "old1.com".to_string(), origin: "https://old1.com".to_string() },
                DnsDomain { host: "old2.com".to_string(), origin: "https://old2.com".to_string() },
            ],
        }))
        .await
        .unwrap();

        // 두 번째 sync: 1개만 — 이전 항목 모두 제거
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![
                DnsDomain { host: "new1.com".to_string(), origin: "https://new1.com".to_string() },
            ],
        }))
        .await
        .unwrap();

        let map = grpc.domain_map.read().await;
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("new1.com"));
        assert!(!map.contains_key("old1.com"));
    }

    #[tokio::test]
    async fn sync_domains_빈_목록은_맵을_비운다() {
        let grpc = make_grpc();
        grpc.sync_domains(Request::new(SyncDomainsRequest {
            domains: vec![DnsDomain { host: "x.com".to_string(), origin: "https://x.com".to_string() }],
        }))
        .await
        .unwrap();

        grpc.sync_domains(Request::new(SyncDomainsRequest { domains: vec![] }))
            .await
            .unwrap();

        let map = grpc.domain_map.read().await;
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn health_는_online_true를_반환한다() {
        let grpc = make_grpc();
        let res = grpc
            .health(Request::new(HealthRequest {}))
            .await
            .unwrap()
            .into_inner();

        assert!(res.online);
    }

    #[tokio::test]
    async fn get_stats_는_스냅샷과_top_domains를_반환한다() {
        let g = make_grpc();
        g.metrics.record(QueryResult::Matched);
        g.metrics.record(QueryResult::Forwarded);
        g.recent.push(crate::metrics::QueryEntry {
            ts_unix_ms: 0, client_ip: "1.1.1.1".into(),
            qname: "a.test".into(), qtype: "A".into(),
            result: QueryResult::Matched, latency_us: 10,
        });
        let res = g.get_stats(Request::new(StatsRequest {})).await.unwrap().into_inner();
        assert_eq!(res.total_queries, 2);
        assert_eq!(res.matched, 1);
        assert_eq!(res.forwarded, 1);
        assert_eq!(res.top_domains.len(), 1);
        assert_eq!(res.top_domains[0].qname, "a.test");
        assert_eq!(res.top_domains[0].count, 1);
    }

    #[tokio::test]
    async fn get_recent_queries_는_limit을_512로_클램프한다() {
        let g = make_grpc();
        for _ in 0..5 {
            g.recent.push(crate::metrics::QueryEntry {
                ts_unix_ms: 0, client_ip: "1.1.1.1".into(),
                qname: "a.test".into(), qtype: "A".into(),
                result: QueryResult::Matched, latency_us: 0,
            });
        }
        // 과도한 limit → 실제 보유분까지만 반환되는지 확인
        let res = g.get_recent_queries(Request::new(RecentQueriesRequest { limit: 10_000 }))
            .await.unwrap().into_inner();
        assert_eq!(res.entries.len(), 5);
        assert_eq!(res.entries[0].result, "matched");

        // 축소 limit
        let res = g.get_recent_queries(Request::new(RecentQueriesRequest { limit: 3 }))
            .await.unwrap().into_inner();
        assert_eq!(res.entries.len(), 3);

        // limit=0 → clamp로 1이 되어 1개 반환
        let res = g.get_recent_queries(Request::new(RecentQueriesRequest { limit: 0 }))
            .await.unwrap().into_inner();
        assert_eq!(res.entries.len(), 1);
    }

    #[tokio::test]
    async fn get_records_는_도메인맵을_a_레코드로_반환한다() {
        let g = make_grpc();
        {
            let mut m = g.domain_map.write().await;
            m.insert("edu.test".into(), "https://edu.test".into());
            m.insert("textbook.net".into(), "https://textbook.net".into());
        }
        let res = g.get_records(Request::new(RecordsRequest {}))
            .await.unwrap().into_inner();
        assert_eq!(res.records.len(), 2);
        for r in &res.records {
            assert_eq!(r.target, "127.0.0.1");
            assert_eq!(r.rtype, "A");
            assert_eq!(r.source, "auto");
        }
        let hosts: std::collections::HashSet<String> = res.records.iter().map(|r| r.host.clone()).collect();
        assert!(hosts.contains("edu.test"));
        assert!(hosts.contains("textbook.net"));
    }
}
