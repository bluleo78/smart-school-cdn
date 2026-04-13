# === Stage 1: Build ===
FROM rust:1-alpine AS build
# musl-dev: alpine C 링킹, protobuf-dev: protoc, libwebp-dev: WebP 인코더
RUN apk add --no-cache musl-dev protobuf-dev libwebp-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/
RUN cargo build --release --package optimizer-service

# === Stage 2: Runtime ===
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libwebp7 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/optimizer-service ./optimizer-service
# 50054: gRPC, 8083: HTTP 헬스체크
EXPOSE 50054 8083
CMD ["./optimizer-service"]
