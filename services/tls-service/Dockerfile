# syntax=docker/dockerfile:1
# === Stage 1: Build ===
FROM rust:1-alpine AS build
# musl-dev: alpine에서 C 링킹에 필요
RUN apk add --no-cache musl-dev protobuf-dev
WORKDIR /app
# workspace 루트 파일 먼저 복사 (레이어 캐시 최적화)
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/
# BuildKit 캐시 마운트 — cargo registry + target 디렉토리를 빌드간 캐시하여 재빌드 속도 대폭 향상
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --release --package tls-service \
    && cp /app/target/release/tls-service /app/tls-service-bin

# === Stage 2: Runtime ===
FROM alpine:3
# curl: HEALTHCHECK 용
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=build /app/tls-service-bin ./tls-service
# 50052: gRPC, 8081: HTTP 헬스체크
EXPOSE 50052 8081
CMD ["./tls-service"]
