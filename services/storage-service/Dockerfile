# === Stage 1: Build ===
FROM rust:1-alpine AS build
# musl-dev: alpine에서 C 링킹에 필요
RUN apk add --no-cache musl-dev protobuf-dev
WORKDIR /app
# workspace 루트 파일 먼저 복사 (레이어 캐시 최적화)
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/
RUN cargo build --release --package storage-service

# === Stage 2: Runtime ===
FROM debian:bookworm-slim
# curl: HEALTHCHECK 용
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/storage-service ./storage-service
# 50051: gRPC, 8080: HTTP 헬스체크
EXPOSE 50051 8080
CMD ["./storage-service"]
