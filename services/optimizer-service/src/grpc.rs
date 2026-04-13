/// OptimizerService gRPC 구현
use std::sync::Arc;
use tonic::{Request, Response, Status};
use cdn_proto::optimizer::{
    optimizer_service_server::OptimizerService,
    OptimizeRequest, OptimizeResponse,
    Empty, GetProfilesResponse, Profile as ProtoProfile, SetProfileRequest,
    GetStatsResponse, DomainStats, HealthResponse,
};
use crate::optimizer::OptimizerDb;

pub struct OptimizerGrpc {
    pub db: Arc<OptimizerDb>,
}

#[tonic::async_trait]
impl OptimizerService for OptimizerGrpc {
    /// 콘텐츠 최적화 — 도메인 프로파일 기반 이미지 변환 또는 텍스트 압축
    async fn optimize(&self, req: Request<OptimizeRequest>) -> Result<Response<OptimizeResponse>, Status> {
        let r = req.into_inner();
        let result = self.db.optimize(&r.data, &r.content_type, &r.domain);
        Ok(Response::new(OptimizeResponse {
            data:           result.data,
            content_type:   result.content_type,
            original_size:  result.original_size,
            optimized_size: result.optimized_size,
        }))
    }

    /// 도메인별 프로파일 목록 조회
    async fn get_profiles(&self, _: Request<Empty>) -> Result<Response<GetProfilesResponse>, Status> {
        let profiles = self.db.get_all_profiles()
            .map_err(|e| Status::internal(e.to_string()))?;
        // get_all_profiles()는 Vec<(String, Profile)>을 반환 — 구조체 필드로 매핑
        Ok(Response::new(GetProfilesResponse {
            profiles: profiles.into_iter().map(|(domain, p)| ProtoProfile {
                domain,
                quality:   p.quality,
                max_width: p.max_width,
                enabled:   p.enabled,
            }).collect(),
        }))
    }

    /// 도메인 프로파일 저장
    async fn set_profile(&self, req: Request<SetProfileRequest>) -> Result<Response<Empty>, Status> {
        let p = req.into_inner().profile
            .ok_or_else(|| Status::invalid_argument("profile is required"))?;
        self.db.set_profile(&p.domain, p.quality, p.max_width, p.enabled)
            .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(Empty {}))
    }

    /// 도메인별 절감 통계 조회
    async fn get_stats(&self, _: Request<Empty>) -> Result<Response<GetStatsResponse>, Status> {
        let stats = self.db.get_all_stats()
            .map_err(|e| Status::internal(e.to_string()))?;
        Ok(Response::new(GetStatsResponse {
            stats: stats.into_iter().map(|s| DomainStats {
                domain:          s.domain,
                original_bytes:  s.original_bytes,
                optimized_bytes: s.optimized_bytes,
                count:           s.count,
            }).collect(),
        }))
    }

    /// 헬스체크 — 항상 online=true
    async fn health(&self, _: Request<Empty>) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse { online: true, latency_ms: 0 }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;
    use tonic::Request;
    use cdn_proto::optimizer::{OptimizeRequest, Empty, SetProfileRequest, Profile as ProtoProfile};
    use crate::optimizer::OptimizerDb;

    fn make_grpc() -> (OptimizerGrpc, TempDir) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.db");
        let db = Arc::new(OptimizerDb::open(path.to_str().unwrap()).unwrap());
        (OptimizerGrpc { db }, dir)
    }

    fn make_test_jpeg() -> Vec<u8> {
        let img = image::DynamicImage::new_rgb8(10, 10);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg).unwrap();
        buf
    }

    #[tokio::test]
    async fn optimize_는_jpeg를_webp로_변환한다() {
        let (grpc, _dir) = make_grpc();
        let jpeg = make_test_jpeg();
        let res = grpc.optimize(Request::new(OptimizeRequest {
            data: jpeg.clone(),
            content_type: "image/jpeg".to_string(),
            domain: "example.com".to_string(),
        })).await.unwrap().into_inner();
        assert_eq!(res.content_type, "image/webp");
        assert_eq!(res.original_size, jpeg.len() as i64);
    }

    #[tokio::test]
    async fn get_profiles_는_저장된_목록을_반환한다() {
        let (grpc, _dir) = make_grpc();
        grpc.set_profile(Request::new(SetProfileRequest {
            profile: Some(ProtoProfile { domain: "a.com".to_string(), quality: 80, max_width: 0, enabled: true }),
        })).await.unwrap();
        let res = grpc.get_profiles(Request::new(Empty {})).await.unwrap().into_inner();
        assert_eq!(res.profiles.len(), 1);
        assert_eq!(res.profiles[0].domain, "a.com");
    }

    #[tokio::test]
    async fn set_profile_은_프로파일을_저장한다() {
        let (grpc, _dir) = make_grpc();
        grpc.set_profile(Request::new(SetProfileRequest {
            profile: Some(ProtoProfile { domain: "b.com".to_string(), quality: 60, max_width: 800, enabled: false }),
        })).await.unwrap();
        let p = grpc.db.get_profile("b.com");
        assert_eq!(p.quality, 60);
        assert!(!p.enabled);
    }

    #[tokio::test]
    async fn get_stats_는_통계를_반환한다() {
        let (grpc, _dir) = make_grpc();
        let jpeg = make_test_jpeg();
        grpc.optimize(Request::new(OptimizeRequest {
            data: jpeg,
            content_type: "image/jpeg".to_string(),
            domain: "stat.com".to_string(),
        })).await.unwrap();
        let res = grpc.get_stats(Request::new(Empty {})).await.unwrap().into_inner();
        assert!(res.stats.iter().any(|s| s.domain == "stat.com" && s.count == 1));
    }

    #[tokio::test]
    async fn health_는_online_true를_반환한다() {
        let (grpc, _dir) = make_grpc();
        let res = grpc.health(Request::new(Empty {})).await.unwrap().into_inner();
        assert!(res.online);
    }
}
