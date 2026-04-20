# syntax=docker/dockerfile:1
# === Stage 1: Build — 호스트 아키 고정 + zig 크로스컴파일 ===
FROM --platform=$BUILDPLATFORM rust:1-alpine AS build
ARG TARGETPLATFORM

RUN apk add --no-cache musl-dev protobuf-dev curl xz \
 && ZIG_VERSION=0.13.0 \
 && ARCH=$(uname -m) \
 && curl -L "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${ARCH}-${ZIG_VERSION}.tar.xz" \
      | tar -xJ -C /usr/local \
 && ln -s "/usr/local/zig-linux-${ARCH}-${ZIG_VERSION}/zig" /usr/local/bin/zig \
 && cargo install --locked cargo-zigbuild \
 && rustup target add x86_64-unknown-linux-musl aarch64-unknown-linux-musl

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    case "$TARGETPLATFORM" in \
      "linux/amd64") TRIPLE=x86_64-unknown-linux-musl ;; \
      "linux/arm64") TRIPLE=aarch64-unknown-linux-musl ;; \
      *) echo "지원하지 않는 플랫폼: $TARGETPLATFORM" && exit 1 ;; \
    esac \
 && cargo zigbuild --release --target $TRIPLE --package dns-service \
 && cp /app/target/$TRIPLE/release/dns-service /app/dns-service-bin

# === Stage 2: Runtime ===
FROM alpine:3
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=build /app/dns-service-bin ./dns-service
# 50053: gRPC, 8082: HTTP 헬스체크
EXPOSE 50053 8082
# 53: DNS UDP
EXPOSE 53/udp
CMD ["./dns-service"]
