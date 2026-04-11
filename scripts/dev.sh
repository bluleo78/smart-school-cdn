#!/bin/bash
# 개발 서버 기동 스크립트
# 기존 프로세스 정리 후 Proxy(Rust) + turbo dev(Node.js) 실행

PORTS="4001,4173,8080,8081"
LOG_DIR="logs"

mkdir -p "$LOG_DIR"

# 기존 프로세스 정리
echo "🔄 포트 ${PORTS} 프로세스 정리..."
lsof -ti:${PORTS} | xargs kill -9 2>/dev/null

# Docker Compose 기동 (--infra 옵션)
if [ "$1" = "--infra" ]; then
  echo "🐳 Docker Compose 기동..."
  docker compose up -d
fi

# Proxy Service (Rust) 백그라운드 실행
echo "🦀 Proxy Service 시작..."
source "$HOME/.cargo/env" 2>/dev/null
cargo run -p proxy 2>&1 | tee "${LOG_DIR}/proxy.log" &

# turbo dev 실행 (Admin Server + Admin Web)
echo "🚀 Admin 서비스 시작..."
pnpm exec turbo dev 2>&1 | tee "${LOG_DIR}/dev-server.log"
