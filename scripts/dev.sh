#!/bin/bash
# 개발 서버 기동 스크립트
# 기존 프로세스 정리 후 turbo dev 실행

PORTS="4001,4173"
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

# turbo dev 실행
echo "🚀 개발 서버 시작..."
pnpm exec turbo dev 2>&1 | tee "${LOG_DIR}/dev-server.log"
