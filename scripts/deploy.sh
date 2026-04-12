#!/usr/bin/env bash
set -euo pipefail

# Smart School CDN 운영 배포 스크립트
# Usage: ./scripts/deploy.sh [proxy|admin|all]
#
# proxy  — Rust 프록시 (HTTP :8080, HTTPS :443, 관리 API :8081)
# admin  — Admin Server (Fastify :7777) + Admin Web (nginx 내장)
# all    — 전체 재배포 (기본값)

COMPOSE="docker compose -f docker-compose.prod.yml"

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[deploy]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# --- 사전 검사 ---

# 미커밋 변경사항 경고
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "미커밋 변경사항이 있습니다. 계속하려면 Enter, 중단하려면 Ctrl+C"
  read -r
fi

# Docker 실행 확인
docker info &>/dev/null || error "Docker가 실행 중이지 않습니다."

# --- 서비스 매핑 ---

TARGET=${1:-all}

case $TARGET in
  proxy)  SERVICES=("proxy") ;;
  admin)  SERVICES=("admin-server") ;;
  all)    SERVICES=("proxy" "admin-server") ;;
  *)      error "알 수 없는 대상: $TARGET (유효값: proxy | admin | all)" ;;
esac

# --- 빌드 ---

log "=== 빌드 ==="
for svc in "${SERVICES[@]}"; do
  log "Building $svc..."
  $COMPOSE build --no-cache "$svc"
done

# --- 배포 ---

log "=== 배포 ==="
for svc in "${SERVICES[@]}"; do
  log "Deploying $svc..."
  $COMPOSE up -d --force-recreate "$svc"
done

# --- 검증 ---

log "=== 검증 (10초 대기) ==="
sleep 10

ALL_OK=true
for svc in "${SERVICES[@]}"; do
  STATUS=$($COMPOSE ps "$svc" --format '{{.Status}}' 2>/dev/null || echo "unknown")
  if echo "$STATUS" | grep -qi "up\|running\|healthy"; then
    log "$svc ✓ $STATUS"
  else
    warn "$svc 상태 확인 필요: $STATUS"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  log "=== 배포 완료 ==="
else
  warn "=== 일부 서비스 상태를 확인하세요: $COMPOSE ps ==="
fi
