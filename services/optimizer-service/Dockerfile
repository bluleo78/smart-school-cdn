# syntax=docker/dockerfile:1
# === Stage 1: Build ===
FROM rust:1-alpine AS build
# musl-dev: alpine C 링킹, protobuf-dev: protoc, libwebp-dev: WebP 인코더
RUN apk add --no-cache musl-dev protobuf-dev libwebp-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/
# BuildKit 캐시 마운트 — cargo registry + target 디렉토리를 빌드간 캐시하여 재빌드 속도 대폭 향상
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    cargo build --release --package optimizer-service \
    && cp /app/target/release/optimizer-service /app/optimizer-service-bin

# === Stage 2: Runtime ===
FROM alpine:3
RUN apk add --no-cache ca-certificates curl libwebp
WORKDIR /app
COPY --from=build /app/optimizer-service-bin ./optimizer-service
# 50054: gRPC, 8083: HTTP 헬스체크
EXPOSE 50054 8083
CMD ["./optimizer-service"]
