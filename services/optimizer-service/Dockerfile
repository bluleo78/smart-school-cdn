# syntax=docker/dockerfile:1
# === Stage 1: Build — 호스트 아키 고정 + zig 크로스컴파일 ===
FROM --platform=$BUILDPLATFORM rust:1-alpine AS build
ARG TARGETPLATFORM

# musl-dev/protobuf-dev: 기존 빌드 의존성, libwebp-dev: WebP 인코더 헤더 (BUILDPLATFORM용),
# curl/xz: zig 다운로드용
RUN apk add --no-cache musl-dev protobuf-dev libwebp-dev curl xz \
 && ZIG_VERSION=0.16.0 \
 && ARCH=$(uname -m) \
 && curl -L "https://ziglang.org/download/${ZIG_VERSION}/zig-${ARCH}-linux-${ZIG_VERSION}.tar.xz" \
      | tar -xJ -C /usr/local \
 && ln -s "/usr/local/zig-${ARCH}-linux-${ZIG_VERSION}/zig" /usr/local/bin/zig \
 && cargo install --locked cargo-zigbuild \
 && rustup target add x86_64-unknown-linux-musl aarch64-unknown-linux-musl

WORKDIR /app
# workspace 루트 파일 먼저 복사 (레이어 캐시 최적화)
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY services/ ./services/

# $TARGETPLATFORM → Rust triple 매핑 후 zigbuild
# libdeflate-sys 1.25.2 AVX-512 intrinsic 가 evex512 target feature 요구 — zig clang 에서 명시 필요
# BuildKit 캐시 마운트로 cargo registry + target 을 빌드 간 캐시
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/app/target,sharing=locked \
    export CFLAGS_x86_64_unknown_linux_musl="-mevex512" \
 && case "$TARGETPLATFORM" in \
      "linux/amd64") TRIPLE=x86_64-unknown-linux-musl ;; \
      "linux/arm64") TRIPLE=aarch64-unknown-linux-musl ;; \
      *) echo "지원하지 않는 플랫폼: $TARGETPLATFORM" && exit 1 ;; \
    esac \
 && cargo zigbuild --release --target $TRIPLE --package optimizer-service \
 && cp /app/target/$TRIPLE/release/optimizer-service /app/optimizer-service-bin

# === Stage 2: Runtime ===
FROM alpine:3
# ca-certificates/curl: 기본 런타임, libwebp: WebP 디코딩 공유 라이브러리 (런타임 의존)
RUN apk add --no-cache ca-certificates curl libwebp
WORKDIR /app
COPY --from=build /app/optimizer-service-bin ./optimizer-service
# 50054: gRPC, 8083: HTTP 헬스체크
EXPOSE 50054 8083
CMD ["./optimizer-service"]
