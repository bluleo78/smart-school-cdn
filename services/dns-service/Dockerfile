# === Stage 1: Build ===
FROM rust:1-alpine AS build
# musl-dev: alpine에서 C 링킹에 필요
RUN apk add --no-cache musl-dev
WORKDIR /app
# workspace 루트 파일 먼저 복사 (레이어 캐시 최적화)
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/
RUN cargo build --release --package dns-service

# === Stage 2: Runtime ===
FROM debian:bookworm-slim
# curl: HEALTHCHECK 용
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/dns-service ./dns-service
# 50053: gRPC, 8082: HTTP 헬스체크, 53/udp: DNS 쿼리
EXPOSE 50053 8082
EXPOSE 53/udp
CMD ["./dns-service"]
