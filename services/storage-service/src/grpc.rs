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
    /// 캐시 조회 — HIT 시 body/content_type 반환, MISS 시 hit=false
    async fn get(&self, req: Request<GetRequest>) -> Result<Response<GetResponse>, Status> {
        let key = req.into_inner().key;
        match self.cache.get(&key).await {
            Some((body, ct)) => Ok(Response::new(GetResponse {
                hit: true,
                body: body.to_vec(),
                content_type: ct.unwrap_or_default(),
            })),
            None => Ok(Response::new(GetResponse {
                hit: false,
                body: vec![],
                content_type: String::new(),
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
        self.cache
            .put(&r.key, &r.url, &r.domain, ct, bytes::Bytes::from(r.body), ttl)
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
