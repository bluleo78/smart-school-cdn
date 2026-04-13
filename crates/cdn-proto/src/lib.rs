pub mod storage {
    tonic::include_proto!("cdn.storage");
}
pub mod tls {
    tonic::include_proto!("cdn.tls");
}
pub mod dns       { tonic::include_proto!("cdn.dns"); }
pub mod optimizer { tonic::include_proto!("cdn.optimizer"); }
