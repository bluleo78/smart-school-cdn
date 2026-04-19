/// Storage gRPC 서비스 구현
/// - CacheLayer를 tonic StorageService 인터페이스로 노출
/// - 각 RPC는 cache.rs의 기존 메서드에 위임

use std::sync::Arc;
use tonic::{Request, Response, Status};

use cdn_proto::storage::{
    storage_service_server::StorageService,
    GetRequest, GetResponse,
    PutRequest, PutResponse,
    PurgeRequest, PurgeResponse, purge_request::Target,
    StatsRequest, StatsResponse, DomainStat,
    PopularRequest, PopularResponse, PopularEntry,
    HealthRequest, HealthResponse,
};

use crate::cache::CacheLayer;

/// gRPC StorageService 구현체 — CacheLayer를 공유 참조로 보유
pub struct StorageGrpc {
    pub cache: Arc<CacheLayer>,
}

#[tonic::async_trait]
impl StorageService for StorageGrpc {
    /// 캐시 조회 — HIT 시 body/content_type/body_br 반환, MISS 시 hit=false
    async fn get(&self, req: Request<GetRequest>) -> Result<Response<GetResponse>, Status> {
        let key = req.into_inner().key;
        match self.cache.get(&key).await {
            Some((body, ct, body_br)) => Ok(Response::new(GetResponse {
                hit: true,
                body: body.to_vec(),
                content_type: ct.unwrap_or_default(),
                body_br: body_br.map(|b| b.to_vec()).unwrap_or_default(),
            })),
            None => Ok(Response::new(GetResponse {
                hit: false,
                body: vec![],
                content_type: String::new(),
                body_br: vec![],
            })),
        }
    }

    /// 캐시 저장 — TTL 0이면 만료 없음
    async fn put(&self, req: Request<PutRequest>) -> Result<Response<PutResponse>, Status> {
        let r = req.into_inner();
        let ttl = if r.ttl_secs > 0 {
            Some(std::time::Duration::from_secs(r.ttl_secs))
        } else {
            None
        };
        let ct = if r.content_type.is_empty() {
            None
        } else {
            Some(r.content_type)
        };
        let body_br = if r.body_br.is_empty() { None } else { Some(bytes::Bytes::from(r.body_br)) };
        self.cache
            .put(&r.key, &r.url, &r.domain, ct, bytes::Bytes::from(r.body), ttl, body_br)
            .await;
        Ok(Response::new(PutResponse {}))
    }

    /// 캐시 퇴거 — URL/도메인/전체 삭제 지원
    async fn purge(&self, req: Request<PurgeRequest>) -> Result<Response<PurgeResponse>, Status> {
        let (files, freed) = match req.into_inner().target {
            Some(Target::Url(url))    => self.cache.purge_by_url(&url).await,
            Some(Target::Domain(dom)) => self.cache.purge_domain(&dom).await,
            Some(Target::All(_))      => self.cache.purge_all().await,
            None                      => (0, 0),
        };
        Ok(Response::new(PurgeResponse {
            purged_files: files,
            freed_bytes: freed,
        }))
    }

    /// 캐시 통계 반환 — 전체 용량 / 사용량 + 도메인별 집계
    async fn stats(&self, _: Request<StatsRequest>) -> Result<Response<StatsResponse>, Status> {
        let total_bytes = self.cache.max_size_bytes;
        let used_bytes  = self.cache.current_size_bytes();

        // 전체 hit_rate: 도메인별 hit_count 합계 기반 (간단 추정)
        let domain_stats_raw = self.cache.get_domain_stats().await;
        let total_hits: u64  = domain_stats_raw.iter().map(|d| d.hit_count).sum();
        // 총 항목 수 기반 hit_rate 추정 — 정밀 추적 없이 hit_count/total 비율
        let entry_count = self.cache.entry_count().await;
        let hit_rate = if entry_count > 0 {
            total_hits as f64 / (total_hits + entry_count) as f64
        } else {
            0.0
        };

        // 도메인별 통계 매핑 — file_count는 현재 추적하지 않으므로 0
        let domain_stats: Vec<DomainStat> = domain_stats_raw
            .into_iter()
            .map(|d| DomainStat {
                domain:     d.domain,
                size_bytes: d.size_bytes,
                file_count: 0,
                hit_rate:   0.0, // 도메인별 정밀 hit_rate는 미구현
            })
            .collect();

        Ok(Response::new(StatsResponse {
            hit_rate,
            total_bytes,
            used_bytes,
            domain_stats,
        }))
    }

    /// 인기 콘텐츠 조회 — hit_count 내림차순, limit 건수 반환
    async fn popular(&self, req: Request<PopularRequest>) -> Result<Response<PopularResponse>, Status> {
        let limit = req.into_inner().limit as usize;
        let entries = self.cache.get_popular(limit).await;
        Ok(Response::new(PopularResponse {
            entries: entries
                .into_iter()
                .map(|e| PopularEntry {
                    url:        e.url,
                    domain:     e.domain,
                    size_bytes: e.size_bytes,
                    hit_count:  e.hit_count,
                })
                .collect(),
        }))
    }

    /// 헬스 체크 — 항상 online=true 반환
    async fn health(&self, _: Request<HealthRequest>) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            online: true,
            latency_ms: 0,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;
    use tonic::Request;

    use cdn_proto::storage::{
        GetRequest, PutRequest, PurgeRequest, StatsRequest, PopularRequest, HealthRequest,
        PurgeAll, purge_request::Target,
    };
    use crate::cache::CacheLayer;

    /// 테스트용 StorageGrpc 인스턴스 생성
    fn make_grpc() -> (StorageGrpc, TempDir) {
        let dir = TempDir::new().unwrap();
        let cache = Arc::new(CacheLayer::new(
            dir.path().to_path_buf(),
            100 * 1024 * 1024, // 100 MiB
        ));
        (StorageGrpc { cache }, dir)
    }

    /// body_br 테스트용 — TempDir를 alive 상태로 유지하는 헬퍼
    async fn new_grpc() -> (StorageGrpc, TempDir) {
        make_grpc()
    }

    #[tokio::test]
    async fn get_miss_시_hit_false를_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .get(Request::new(GetRequest { key: "missing_key".to_string() }))
            .await
            .unwrap()
            .into_inner();

        assert!(!res.hit);
        assert!(res.body.is_empty());
    }

    #[tokio::test]
    async fn put_후_get_hit_시_body를_반환한다() {
        let (grpc, _dir) = make_grpc();
        // 캐시에 저장
        grpc.put(Request::new(PutRequest {
            key:          "k1".to_string(),
            url:          "https://example.com/file.mp4".to_string(),
            domain:       "example.com".to_string(),
            content_type: "video/mp4".to_string(),
            body:         b"hello".to_vec(),
            ttl_secs:     0,
            body_br:      vec![],
        }))
        .await
        .unwrap();

        // 조회
        let res = grpc
            .get(Request::new(GetRequest { key: "k1".to_string() }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.hit);
        assert_eq!(res.body, b"hello");
        assert_eq!(res.content_type, "video/mp4");
    }

    #[tokio::test]
    async fn purge_url_후_get은_miss를_반환한다() {
        let (grpc, _dir) = make_grpc();
        grpc.put(Request::new(PutRequest {
            key: "k2".to_string(),
            url: "https://example.com/img.png".to_string(),
            domain: "example.com".to_string(),
            content_type: "image/png".to_string(),
            body: b"img".to_vec(),
            ttl_secs: 0,
            body_br: vec![],
        }))
        .await
        .unwrap();

        grpc.purge(Request::new(PurgeRequest {
            target: Some(Target::Url("https://example.com/img.png".to_string())),
        }))
        .await
        .unwrap();

        let res = grpc
            .get(Request::new(GetRequest { key: "k2".to_string() }))
            .await
            .unwrap()
            .into_inner();
        assert!(!res.hit);
    }

    #[tokio::test]
    async fn purge_all_후_entry_count는_0이다() {
        let (grpc, _dir) = make_grpc();
        // 항목 2개 저장
        for i in 0..2u8 {
            grpc.put(Request::new(PutRequest {
                key:          format!("k{i}"),
                url:          format!("https://example.com/{i}"),
                domain:       "example.com".to_string(),
                content_type: "text/plain".to_string(),
                body:         vec![i],
                ttl_secs:     0,
                body_br:      vec![],
            }))
            .await
            .unwrap();
        }

        let purge_res = grpc
            .purge(Request::new(PurgeRequest {
                target: Some(Target::All(PurgeAll {})),
            }))
            .await
            .unwrap()
            .into_inner();

        assert!(purge_res.purged_files >= 1);
        assert_eq!(grpc.cache.entry_count().await, 0);
    }

    #[tokio::test]
    async fn stats_는_올바른_총_용량을_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc
            .stats(Request::new(StatsRequest {}))
            .await
            .unwrap()
            .into_inner();

        assert_eq!(res.total_bytes, 100 * 1024 * 1024);
        assert_eq!(res.used_bytes, 0);
    }

    #[tokio::test]
    async fn popular_limit_반영하여_최대_n건_반환한다() {
        let (grpc, _dir) = make_grpc();
        // 3개 저장 후 limit 2로 조회
        for i in 0..3u8 {
            grpc.put(Request::new(PutRequest {
                key: format!("p{i}"), url: format!("https://ex.com/{i}"),
                domain: "ex.com".to_string(), content_type: "text/plain".to_string(),
                body: vec![i], ttl_secs: 0, body_br: vec![],
            }))
            .await
            .unwrap();
        }

        let res = grpc
            .popular(Request::new(PopularRequest { limit: 2 }))
            .await
            .unwrap()
            .into_inner();

        assert!(res.entries.len() <= 2);
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

    #[tokio::test]
    async fn body_br이_포함된_put_후_get_에서_함께_반환된다() {
        let (grpc, _dir) = new_grpc().await;
        grpc.put(Request::new(PutRequest {
            key:          "k-br".to_string(),
            url:          "https://a.test/a.html".to_string(),
            domain:       "a.test".to_string(),
            content_type: "text/html".to_string(),
            body:         b"<!DOCTYPE html>...original...".to_vec(),
            ttl_secs:     0,
            body_br:      b"FAKE_BR_BLOB".to_vec(),
        })).await.unwrap();

        let res = grpc.get(Request::new(GetRequest {
            key: "k-br".to_string(),
        })).await.unwrap().into_inner();

        assert!(res.hit);
        assert_eq!(res.body, b"<!DOCTYPE html>...original...");
        assert_eq!(res.body_br, b"FAKE_BR_BLOB");
        assert_eq!(res.content_type, "text/html");
    }

    #[tokio::test]
    async fn body_br_가_없으면_빈_bytes로_반환된다() {
        let (grpc, _dir) = new_grpc().await;
        grpc.put(Request::new(PutRequest {
            key:          "k-nobr".to_string(),
            url:          "https://a.test/b.png".to_string(),
            domain:       "a.test".to_string(),
            content_type: "image/png".to_string(),
            body:         b"PNG_DATA".to_vec(),
            ttl_secs:     0,
            body_br:      vec![],
        })).await.unwrap();

        let res = grpc.get(Request::new(GetRequest {
            key: "k-nobr".to_string(),
        })).await.unwrap().into_inner();

        assert!(res.hit);
        assert_eq!(res.body, b"PNG_DATA");
        assert!(res.body_br.is_empty());
    }
}
