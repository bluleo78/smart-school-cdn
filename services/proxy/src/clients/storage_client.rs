/// Storage gRPC 클라이언트 — storage-service:50051 통신
use std::time::Duration;
use bytes::Bytes;
use tonic::transport::Channel;

use cdn_proto::storage::{
    storage_service_client::StorageServiceClient,
    GetRequest, PutRequest, PurgeRequest, PurgeAll,
    purge_request::Target,
    StatsResponse, PopularResponse,
};

#[derive(Clone)]
pub struct StorageClient {
    inner: StorageServiceClient<Channel>,
}

impl StorageClient {
    pub async fn connect(url: &str) -> Result<Self, tonic::transport::Error> {
        let ch = tonic::transport::Channel::from_shared(url.to_string())
            .expect("유효하지 않은 storage URL")
            .timeout(Duration::from_secs(10))
            .connect()
            .await?;
        Ok(Self {
            inner: StorageServiceClient::new(ch)
                .max_decoding_message_size(64 * 1024 * 1024)
                .max_encoding_message_size(64 * 1024 * 1024),
        })
    }

    /// 캐시 조회 — HIT 시 (body, content_type) 반환
    pub async fn get(&mut self, key: &str) -> Option<(Bytes, Option<String>)> {
        let resp = self.inner.get(GetRequest { key: key.to_string() }).await.ok()?.into_inner();
        if resp.hit {
            let ct = if resp.content_type.is_empty() { None } else { Some(resp.content_type) };
            Some((Bytes::from(resp.body), ct))
        } else {
            None
        }
    }

    /// 캐시 저장
    pub async fn put(
        &mut self,
        key: &str, url: &str, domain: &str,
        content_type: Option<String>,
        body: Bytes,
        ttl: Option<Duration>,
    ) {
        let _ = self.inner.put(PutRequest {
            key:          key.to_string(),
            url:          url.to_string(),
            domain:       domain.to_string(),
            content_type: content_type.unwrap_or_default(),
            body:         body.to_vec(),
            ttl_secs:     ttl.map(|d| d.as_secs()).unwrap_or(0),
        }).await;
    }

    /// 통계 조회
    pub async fn stats(&mut self) -> Option<StatsResponse> {
        use cdn_proto::storage::StatsRequest;
        self.inner.stats(StatsRequest {}).await.ok().map(|r| r.into_inner())
    }

    /// 인기 콘텐츠
    pub async fn popular(&mut self, limit: u32) -> Option<PopularResponse> {
        use cdn_proto::storage::PopularRequest;
        self.inner.popular(PopularRequest { limit }).await.ok().map(|r| r.into_inner())
    }

    /// URL 퍼지
    pub async fn purge_url(&mut self, url: &str) -> (u64, u64) {
        self.purge(Target::Url(url.to_string())).await
    }

    /// 도메인 퍼지
    pub async fn purge_domain(&mut self, domain: &str) -> (u64, u64) {
        self.purge(Target::Domain(domain.to_string())).await
    }

    /// 전체 퍼지
    pub async fn purge_all(&mut self) -> (u64, u64) {
        self.purge(Target::All(PurgeAll {})).await
    }

    async fn purge(&mut self, target: Target) -> (u64, u64) {
        let r = self.inner.purge(PurgeRequest { target: Some(target) }).await;
        r.map(|resp| {
            let r = resp.into_inner();
            (r.purged_files, r.freed_bytes)
        }).unwrap_or((0, 0))
    }
}
