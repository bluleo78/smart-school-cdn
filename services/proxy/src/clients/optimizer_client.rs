/// Optimizer gRPC 클라이언트 — optimizer-service:50054 통신
use std::time::Duration;
use bytes::Bytes;
use tonic::transport::Channel;

use cdn_proto::optimizer::{
    optimizer_service_client::OptimizerServiceClient,
    OptimizeRequest,
};

#[derive(Clone)]
pub struct OptimizerClient {
    inner: OptimizerServiceClient<Channel>,
}

impl OptimizerClient {
    pub async fn connect(url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let ch = tonic::transport::Channel::from_shared(url.to_string())?
            .timeout(Duration::from_secs(30)) // 이미지 변환은 시간이 걸릴 수 있음
            .connect()
            .await?;
        Ok(Self {
            inner: OptimizerServiceClient::new(ch)
                .max_decoding_message_size(64 * 1024 * 1024)
                .max_encoding_message_size(64 * 1024 * 1024),
        })
    }

    /// 콘텐츠 최적화 — 실패 시 None 반환 (caller가 원본 사용)
    pub async fn optimize(
        &mut self,
        data: Bytes,
        content_type: String,
        domain: &str,
    ) -> Option<(Bytes, String)> {
        let resp = self.inner.optimize(OptimizeRequest {
            data: data.to_vec(),
            content_type,
            domain: domain.to_string(),
        }).await.ok()?.into_inner();
        Some((Bytes::from(resp.data), resp.content_type))
    }
}
