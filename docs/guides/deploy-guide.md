# 운영 배포 가이드

## 개요

멀티플랫폼 Docker 이미지를 빌드하여 GHCR에 push한 뒤, 운영 서버(`~/prod/smart-school-cdn`)에서 pull하여 실행한다.

## 서비스 구성

| 서비스 | 이미지 | 포트 | 설명 |
|--------|--------|------|------|
| storage-service | `ghcr.io/bluleo78/smart-school-cdn/storage-service:latest` | 50051 (gRPC), 8080 (health) | Rust 캐시 스토리지 |
| tls-service | `ghcr.io/bluleo78/smart-school-cdn/tls-service:latest` | 50052 (gRPC), 8081 (health) | Rust TLS/인증서 관리 |
| dns-service | `ghcr.io/bluleo78/smart-school-cdn/dns-service:latest` | 50053 (gRPC), 8082 (health), 5353:53/udp | Rust DNS 오버라이드 |
| proxy | `ghcr.io/bluleo78/smart-school-cdn/proxy:latest` | 8080 (HTTP), 443 (HTTPS) | Rust 프록시 + TLS |
| admin-server | `ghcr.io/bluleo78/smart-school-cdn/admin-server:latest` | 4001 (내부) | Fastify API |
| admin-web | `ghcr.io/bluleo78/smart-school-cdn/admin-web:latest` | 7777 | React + nginx |
| dozzle | `amir20/dozzle:latest` | 9999 | 컨테이너 로그 뷰어 |

## 배포 명령

```bash
pnpm ship                # 전체 재배포 (proxy + admin-server + admin-web)
pnpm ship:proxy          # Proxy만 재배포
pnpm ship:admin          # Admin Server + Admin Web만 재배포
```

**흐름:**
1. `docker buildx` 멀티플랫폼 빌드 (linux/amd64, linux/arm64)
2. GHCR push
3. `~/prod/smart-school-cdn`에서 `docker compose pull + up -d --force-recreate`
4. 10초 대기 후 컨테이너 상태 검증

## 최초 운영 서버 세팅

```bash
mkdir -p ~/prod/smart-school-cdn
cp deploy/docker-compose.yml ~/prod/smart-school-cdn/docker-compose.yml
cp deploy/nginx.conf ~/prod/smart-school-cdn/nginx.conf
cp .env.example ~/prod/smart-school-cdn/.env
# .env 편집 (CACHE_MAX_SIZE_GB 등)
pnpm ship
```

## 운영 설정 변경

`~/prod/smart-school-cdn/` 파일을 직접 수정한다. (`deploy/` 디렉터리는 레퍼런스 사본)

| 파일 | 용도 |
|------|------|
| `docker-compose.yml` | 컨테이너 구성, 포트, 환경 변수 |
| `nginx.conf` | Admin Web API 리버스 프록시 설정 |
| `.env` | CACHE_MAX_SIZE_GB, WEB_PORT 등 |

설정 변경 후 적용:
```bash
cd ~/prod/smart-school-cdn
docker compose up -d
```

## 포트 충돌 주의

로컬 테스트(`pnpm docker:up`)와 운영 컨테이너가 같은 호스트에서 동시에 실행될 경우:

| | 로컬 테스트 | 운영 |
|---|---|---|
| proxy HTTP | 8082 | 8080 |
| proxy HTTPS | 4443 | 443 |
| admin-web | 7778 | 7777 |

운영 배포 전 로컬 테스트 컨테이너를 내린다:
```bash
docker compose -f docker-compose.prod.yml down
```

## GHCR 인증

GHCR push 권한이 필요하다:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u bluleo78 --password-stdin
```
