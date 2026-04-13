/// OptimizerService gRPC 구현
use std::sync::Arc;
use tonic::{Request, Response, Status};
use cdn_proto::optimizer::{
    optimizer_service_server::OptimizerService,
    OptimizeRequest, OptimizeResponse,
    Empty, GetProfilesResponse, SetProfileRequest,
    GetStatsResponse, HealthResponse,
};
use crate::optimizer::OptimizerDb;

pub struct OptimizerGrpc {
    pub db: Arc<OptimizerDb>,
}

#[tonic::async_trait]
impl OptimizerService for OptimizerGrpc {
    async fn optimize(&self, _req: Request<OptimizeRequest>) -> Result<Response<OptimizeResponse>, Status> {
        Err(Status::unimplemented("not yet"))
    }
    async fn get_profiles(&self, _: Request<Empty>) -> Result<Response<GetProfilesResponse>, Status> {
        Err(Status::unimplemented("not yet"))
    }
    async fn set_profile(&self, _req: Request<SetProfileRequest>) -> Result<Response<Empty>, Status> {
        Err(Status::unimplemented("not yet"))
    }
    async fn get_stats(&self, _: Request<Empty>) -> Result<Response<GetStatsResponse>, Status> {
        Err(Status::unimplemented("not yet"))
    }
    async fn health(&self, _: Request<Empty>) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse { online: true, latency_ms: 0 }))
    }
}
