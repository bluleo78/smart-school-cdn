#!/usr/bin/env bash
set -euo pipefail

# Smart School CDN 운영 배포 스크립트
# Usage: ./scripts/deploy.sh [proxy|storage-service|tls-service|dns-service|admin-server|admin-web|all]
#
# proxy           — Rust 프록시 (HTTP :8080, HTTPS :443, 관리 API :8081)
# storage-service — 캐시 스토리지 gRPC 서비스 (:50051)
# tls-service     — TLS 인증서 gRPC 서비스 (:50052)
# dns-service     — DNS gRPC + UDP 서비스 (:50053, :53)
# optimizer-service — 이미지 최적화 gRPC 서비스 (:50054)
# admin-server    — Fastify API (:4001 내부)
# admin-web       — nginx 정적 서빙 + API 프록시 (:7777)
# all             — 전체 재배포 (기본값)
#
# 흐름:
#   1. docker buildx로 멀티플랫폼 이미지 빌드 + GHCR push
#   2. ~/prod/smart-school-cdn 에서 docker compose pull + up

export DOCKER_CONTEXT=orbstack

REGISTRY="ghcr.io/bluleo78/smart-school-cdn"
PROD_DIR="$HOME/prod/smart-school-cdn"
PLATFORM="linux/amd64,linux/arm64"

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[deploy]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# --- 사전 검사 ---

docker info &>/dev/null || error "Docker가 실행 중이지 않습니다."
[ -d "$PROD_DIR" ] || error "운영 디렉터리가 없습니다: $PROD_DIR"

# --- buildx 멀티플랫폼 빌더 확인 ---

ensure_builder() {
  if ! docker buildx inspect multiplatform &>/dev/null; then
    log "멀티플랫폼 buildx 빌더 생성"
    docker buildx create --name multiplatform --use
  else
    docker buildx use multiplatform
  fi
}

# --- 서비스별 빌드 + push ---
# admin-server / admin-web은 pnpm workspace 루트를 context로 사용한다.

build_and_push() {
  local svc=$1
  case $svc in
    proxy)
      log "Building + pushing proxy..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/proxy:latest" \
        -f services/proxy/Dockerfile --push .
      ;;
    admin-server)
      log "Building + pushing admin-server..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/admin-server:latest" \
        -f services/admin-server/Dockerfile --push .
      ;;
    storage-service)
      log "Building + pushing storage-service..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/storage-service:latest" \
        -f services/storage-service/Dockerfile --push .
      ;;
    tls-service)
      log "Building + pushing tls-service..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/tls-service:latest" \
        -f services/tls-service/Dockerfile --push .
      ;;
    dns-service)
      log "Building + pushing dns-service..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/dns-service:latest" \
        -f services/dns-service/Dockerfile --push .
      ;;
    optimizer-service)
      log "Building + pushing optimizer-service..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/optimizer-service:latest" \
        -f services/optimizer-service/Dockerfile --push .
      ;;
    admin-web)
      log "Building + pushing admin-web..."
      docker buildx build --platform "$PLATFORM" \
        -t "$REGISTRY/admin-web:latest" \
        -f services/admin-web/Dockerfile --push .
      ;;
  esac
}

# --- 서비스 배포 ---

deploy_service() {
  local svc=$1
  log "Deploying $svc..."
  cd "$PROD_DIR"
  docker compose pull "$svc"
  docker compose up -d --force-recreate "$svc"
  cd - > /dev/null
}

# --- 컨테이너 상태 검증 ---

verify_service() {
  local svc=$1
  local status
  status=$(cd "$PROD_DIR" && docker compose ps "$svc" --format '{{.Status}}' 2>/dev/null || echo "unknown")
  if echo "$status" | grep -qi "up\|running\|healthy"; then
    log "$svc ✓ $status"
  else
    warn "$svc 상태 확인 필요: $status"
    return 1
  fi
}

# --- Main ---

TARGET=${1:-all}

case $TARGET in
  proxy)           SERVICES=("proxy") ;;
  storage-service) SERVICES=("storage-service") ;;
  tls-service)     SERVICES=("tls-service") ;;
  dns-service)      SERVICES=("dns-service") ;;
  optimizer-service) SERVICES=("optimizer-service") ;;
  admin-server)    SERVICES=("admin-server") ;;
  admin-web)       SERVICES=("admin-web") ;;
  admin)           SERVICES=("admin-server" "admin-web") ;;
  all)             SERVICES=("storage-service" "tls-service" "dns-service" "optimizer-service" "proxy" "admin-server" "admin-web") ;;
  *)               error "알 수 없는 대상: $TARGET (유효값: proxy | storage-service | tls-service | dns-service | optimizer-service | admin-server | admin-web | admin | all)" ;;
esac

log "=== 빌드 + Push → GHCR ==="
ensure_builder
for svc in "${SERVICES[@]}"; do
  build_and_push "$svc"
done

log "=== 배포 ==="
for svc in "${SERVICES[@]}"; do
  deploy_service "$svc"
done

log "=== 검증 (10초 대기) ==="
sleep 10

ALL_OK=true
for svc in "${SERVICES[@]}"; do
  verify_service "$svc" || ALL_OK=false
done

echo ""
if $ALL_OK; then
  log "=== 배포 완료 ==="
else
  warn "=== 일부 서비스 상태를 확인하세요: docker compose -C $PROD_DIR ps ==="
fi
