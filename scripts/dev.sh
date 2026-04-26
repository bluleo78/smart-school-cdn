#!/bin/bash
# 개발 서버 기동 스크립트
# Rust 서비스(gRPC + Proxy) → Admin(Node.js) 순서로 로컬 직접 기동

# .env.local이 있으면 로드 (gitignore — 로컬 포트 오버라이드 등 개발자별 설정)
if [ -f "$(dirname "$0")/../.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../.env.local"
  set +a
fi

# dev proxy 포트: 운영(8080/443/8081)과 충돌하지 않도록 env로 오버라이드 가능
PROXY_HTTP_PORT="${PROXY_HTTP_PORT:-8080}"
PROXY_HTTPS_PORT="${PROXY_HTTPS_PORT:-443}"
PROXY_ADMIN_PORT="${PROXY_ADMIN_PORT:-8081}"
export PROXY_HTTP_PORT PROXY_HTTPS_PORT PROXY_ADMIN_PORT

PORTS="4001,4173,${PROXY_HTTP_PORT},${PROXY_ADMIN_PORT}"
LOG_DIR="logs"

mkdir -p "$LOG_DIR"

# Phase 21 — admin-server / proxy 가 요구하는 인증 env 의 dev 기본값 주입
# 운영 .env 의 시크릿이 아닌 dev 전용 placeholder. 이미 환경에 설정되어 있으면 유지.
export JWT_SECRET="${JWT_SECRET:-dev-secret-dev-secret-dev-secret-dev}"
export INTERNAL_API_TOKEN="${INTERNAL_API_TOKEN:-dev-internal-token-dev-internal-token-dev}"

# gRPC URL — 로컬 직접 실행이므로 Docker 호스트명 대신 localhost 사용
export STORAGE_GRPC_URL="${STORAGE_GRPC_URL:-http://localhost:50051}"
export TLS_GRPC_URL="${TLS_GRPC_URL:-http://localhost:50052}"
export DNS_GRPC_URL="${DNS_GRPC_URL:-http://localhost:50053}"
export OPTIMIZER_GRPC_URL="${OPTIMIZER_GRPC_URL:-http://localhost:50054}"
export ADMIN_SNAPSHOT_URL="${ADMIN_SNAPSHOT_URL:-http://localhost:4001}"
export PROXY_ADMIN_URL="${PROXY_ADMIN_URL:-http://localhost:${PROXY_ADMIN_PORT}}"

# 기존 프로세스 정리
echo "🔄 포트 ${PORTS} 프로세스 정리..."
lsof -ti:${PORTS} | xargs kill -9 2>/dev/null

# Rust 서비스 전체 로컬 기동
source "$HOME/.cargo/env" 2>/dev/null
echo "🦀 Rust 서비스 시작..."
cargo run -p storage-service  2>&1 | tee "${LOG_DIR}/storage-service.log"  &
cargo run -p tls-service      2>&1 | tee "${LOG_DIR}/tls-service.log"      &
cargo run -p dns-service      2>&1 | tee "${LOG_DIR}/dns-service.log"      &
cargo run -p optimizer-service 2>&1 | tee "${LOG_DIR}/optimizer-service.log" &
cargo run -p proxy            2>&1 | tee "${LOG_DIR}/proxy.log"            &

# turbo dev 실행 (Admin Server + Admin Web)
echo "🚀 Admin 서비스 시작..."
pnpm exec turbo dev 2>&1 | tee "${LOG_DIR}/dev-server.log"
