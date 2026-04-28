# 디지털 교과서 CDN 서비스 아키텍처

> 작성일: 2026-04-11

## 1. 개요

학교 내부 네트워크에 배치하는 온프레미스 CDN 서비스. iPad 등 태블릿에서 디지털 교과서 콘텐츠를 빠르게 로딩하기 위해 리버스 프록시 + Split-Horizon DNS 방식으로 콘텐츠를 캐싱/최적화/관리한다.

### 접근 방식

- **리버스 프록시 + DNS 오버라이드**: iPad에 별도 설정 없이 동작
- **마이크로서비스 구성**: 역할별 서비스 분리
- **Rust (네트워크 엔진) + Node.js/Fastify (관리/비즈니스) + React (대시보드)**

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      학교 내부 네트워크                        │
│                                                             │
│  [iPad] ── Wi-Fi ──→ [DNS Service] ──→ [Proxy Service]      │
│                       (Rust)            (Rust/hyper)         │
│                       UDP:53            HTTPS:443            │
│                                              │               │
│                                    ┌─────────┼─────────┐    │
│                                    │         │         │    │
│                              [Storage]  [Optimizer] [TLS]   │
│                              (Rust)     (Rust)      (Rust)  │
│                                │                            │
│                           [디스크/SSD]                       │
│                                                             │
│  [관리자] ──→ [Admin Service]                                │
│               (Node.js/Fastify + React)                     │
│               HTTP:4001                                     │
└─────────────────────────────────────────────────────────────┘
                          │
                     [외부 인터넷]
                     (원본 서버)
```

---

## 3. 서비스 목록

### 3-1. Proxy Service (Rust)

- **역할**: HTTPS 요청 수신, 캐시 조회, 원본 서버 요청, 응답 반환
- **기술**: hyper / axum + tokio
- **포트**: 443 (HTTPS)
- **핵심 기능**:
  - TLS 터미네이션 (내부 CA 인증서)
  - 캐시 히트 시 Storage에서 즉시 응답
  - 캐시 미스 시 원본 서버에서 fetch → Optimizer(선택) → Storage 저장
  - Cache-Control / ETag / Last-Modified 헤더 처리
  - 동시 요청 병합 (같은 URL 동시 요청 시 원본에 1회만 요청)
  - X-Cache-Status 헤더 추가 (HIT/MISS/STALE)

### 3-2. Storage Service (Rust)

- **역할**: 캐시 콘텐츠 저장/조회/삭제, 스토리지 관리
- **기술**: tokio + 파일시스템 + SQLite(메타데이터)
- **핵심 기능**:
  - 2단 캐시: 메모리(핫 콘텐츠) + 디스크(대용량)
  - LRU 퇴거 정책
  - 용량 제한 (max_size 설정)
  - 캐시 퍼지 (URL별, 도메인별, 패턴별, 전체)
  - 메타데이터 관리 (URL, 크기, TTL, 히트 수, 최종 접근 시간)
  - 스토리지 통계 API (사용량, 히트율, 도메인별 용량)

### 3-3. Optimizer Service (Rust)

- **역할**: 콘텐츠 최적화 (이미지/텍스트)
- **기술**: image-rs / libvips 바인딩
- **핵심 기능**:
  - 이미지 리사이즈 (해상도 변환)
  - 이미지 포맷 변환 (PNG/JPEG → WebP/AVIF)
  - 이미지 품질 조정 (Quality 파라미터)
  - 텍스트 압축 (gzip/brotli)
  - 최적화 프로파일 설정 (모바일/태블릿/데스크톱)

### 3-4. DNS Service (Rust)

- **역할**: 대상 도메인을 캐시 서버 IP로 오버라이드
- **기술**: hickory-dns (구 trust-dns)
- **포트**: 53 (UDP/TCP)
- **핵심 기능**:
  - 등록된 도메인 → 캐시 서버 IP 반환
  - 미등록 도메인 → 외부 DNS로 포워딩
  - 도메인 목록 동적 관리 (Admin API에서 추가/삭제)
  - 와일드카드 도메인 지원 (*.textbook.com)

### 3-5. TLS Service (Rust)

- **역할**: 내부 CA 관리, 도메인별 인증서 자동 발급
- **기술**: rcgen (인증서 생성) + rustls
- **핵심 기능**:
  - 내부 루트 CA 생성/관리
  - 새 도메인 등록 시 인증서 자동 발급
  - 인증서 갱신
  - CA 인증서 다운로드 엔드포인트 (iPad 설치용)
  - 와일드카드 인증서 지원

### 3-6. Admin Service (Node.js)

- **역할**: 관리 API + Dashboard 서빙 + 비즈니스 로직
- **기술**: Fastify + TypeScript + better-sqlite3
- **포트**: 4001 (API), 7777 (Admin Web nginx — 프로덕션)
- **DB**: SQLite (도메인 설정, 사용자, 감사 로그, 통계 이력)
- **핵심 기능**:
  - **REST API**:
    - 도메인 관리: 캐싱 대상 도메인 CRUD → DNS/TLS 서비스에 전파
    - 캐시 퍼지: URL/패턴/도메인별 퍼지 요청 → Storage 서비스에 전달
    - 통계 조회: 캐시 히트율, 대역폭 절감, 도메인별 사용량, 인기 콘텐츠
    - 최적화 설정: Optimizer 프로파일 관리
    - 시스템 상태: 각 서비스 헬스체크, 디스크 사용량
  - **Dashboard (React)**: 빌드 결과물을 정적 파일로 서빙
    - 대시보드: 실시간 트래픽, 캐시 히트율, 대역폭 절감 그래프
    - 도메인 관리: 캐싱 대상 도메인 추가/삭제/상태
    - 캐시 관리: 퍼지, 스토리지 사용량, 인기 콘텐츠 목록
    - 최적화 설정: 이미지 품질/해상도 프로파일
    - 시스템: 서비스 상태, 로그, 설정
  - **확장 가능 영역**:
    - Pre-warming 스케줄러
    - LMS/MDM 연동
    - 리포팅 (주간/월간 사용 보고서)
    - 알림 (디스크 부족, 장애 감지)
    - 다중 학교 통합 관리

---

## 4. 서비스간 통신

```
                      gRPC (tonic)
Proxy Service ←──────────────────→ Storage Service
              ←──────────────────→ Optimizer Service
              ←──────────────────→ TLS Service (인증서 조회)

                      gRPC (@grpc/grpc-js)
Admin Service ←──────────────────→ Storage Service (퍼지, 통계)
              ←──────────────────→ DNS Service (도메인 관리)
              ←──────────────────→ TLS Service (인증서 관리)
              ←──────────────────→ Proxy Service (상태, 통계)
              ←──────────────────→ Optimizer Service (설정)

                      정적 파일 서빙
Admin Service ──────────────────→ React Dashboard (빌드 결과물)
```

### 통신 방식 선택 이유

- **Rust 서비스간 (gRPC)**: 바이너리 프로토콜로 성능 우수, .proto로 타입 안전, 바이너리 데이터(캐시 콘텐츠) 전달에 적합
- **Admin Service ↔ Rust 서비스 (gRPC)**: tonic(Rust) + @grpc/grpc-js(Node.js), .proto 공유
- **Dashboard ↔ Admin Service**: React 빌드 결과물을 Fastify가 정적 파일로 서빙, API는 같은 포트의 /api/* 경로

---

## 5. 요청 흐름

### 5-1. 콘텐츠 요청 (캐시 히트)

```
iPad → DNS Service: textbook.com 조회
    ← 10.0.1.100 (캐시 서버)

iPad → Proxy Service: GET https://textbook.com/chapter1/page3.html
    Proxy → Storage: 캐시 조회 (key: textbook.com/chapter1/page3.html)
    Storage → Proxy: HIT + 콘텐츠 반환
    Proxy → iPad: 200 OK + X-Cache-Status: HIT
```

### 5-2. 콘텐츠 요청 (캐시 미스 + 최적화)

```
iPad → Proxy Service: GET https://textbook.com/images/diagram.png
    Proxy → Storage: 캐시 조회
    Storage → Proxy: MISS

    Proxy → 원본 서버 (외부): GET /images/diagram.png
    원본 → Proxy: 200 OK + 원본 이미지 (2MB PNG)

    Proxy → Optimizer: 이미지 최적화 요청 (WebP 변환, 80% 품질)
    Optimizer → Proxy: 최적화된 이미지 (200KB WebP)

    Proxy → Storage: 저장 (원본 + 최적화 버전)
    Proxy → iPad: 200 OK + 최적화 이미지 + X-Cache-Status: MISS
```

### 5-3. 캐시 퍼지

```
관리자 → Dashboard: textbook.com 전체 퍼지 클릭
    Dashboard → Admin API: DELETE /api/cache/purge?domain=textbook.com
    Admin API → Storage Service: 도메인별 퍼지 gRPC 호출
    Storage: 해당 도메인 캐시 엔트리 삭제
    Admin API → Dashboard: 퍼지 완료 (삭제된 엔트리 수, 해제된 용량)
```

### 5-4. 새 도메인 등록

```
관리자 → Dashboard: 새 도메인 추가 (math-textbook.com)
    Dashboard → Admin API: POST /api/domains { domain: "math-textbook.com" }
    Admin API → TLS Service: 인증서 발급 요청
    TLS Service: math-textbook.com 인증서 생성 (내부 CA 서명)
    Admin API → DNS Service: 도메인 오버라이드 등록
    DNS Service: math-textbook.com → 10.0.1.100 매핑 추가
    Admin API → Proxy Service: 새 도메인 설정 반영
    Admin API → Dashboard: 등록 완료
```

---

## 6. 기술 스택 요약

> smart-fire-hub 프로젝트의 프론트엔드/툴링 패턴을 참고하여 통일성 유지

### 6-1. Rust 서비스 (네트워크 엔진)

| 서비스 | 기술 |
|--------|------|
| Proxy Service | Rust + axum + tokio + rustls |
| Storage Service | Rust + tokio + 파일시스템 + SQLite (메타데이터) |
| Optimizer Service | Rust + image-rs (또는 libvips 바인딩) |
| DNS Service | Rust + hickory-dns |
| TLS Service | Rust + rcgen + rustls |
| 서비스간 통신 | gRPC (tonic) |
| 인터페이스 정의 | Protocol Buffers (.proto) |

### 6-2. Admin Service (Node.js)

| 영역 | 기술 | 비고 |
|------|------|------|
| 런타임 | Node.js + TypeScript (ESM) | |
| API 프레임워크 | Fastify | |
| DB | better-sqlite3 | 설정/통계/로그 |
| gRPC 클라이언트 | @grpc/grpc-js | Rust 서비스와 통신 |
| 검증 | Zod v4 | 요청/응답 스키마 검증 |

### 6-3. Dashboard (React)

| 영역 | 기술 | 비고 |
|------|------|------|
| 프레임워크 | React 19 + TypeScript | |
| 빌드 도구 | Vite | |
| 라우팅 | React Router v7 | lazy-loaded 페이지 |
| 서버 상태 | TanStack Query (React Query) | 캐시 통계 등 |
| 폼 처리 | React Hook Form + Zod v4 | 도메인 추가 등 |
| HTTP 클라이언트 | Axios | Admin API 호출 |
| UI 프레임워크 | shadcn/ui (new-york 스타일) | Radix + Tailwind CSS v4 |
| 아이콘 | Lucide React | |
| 차트 | Recharts | 트래픽/히트율 그래프 |
| 테마 | CSS Variables (dark/light) | next-themes |

### 6-4. 모노레포 / 툴링

| 영역 | 기술 | 비고 |
|------|------|------|
| 패키지 매니저 | pnpm | |
| 모노레포 도구 | Turborepo | build/dev/test/lint 파이프라인 |
| 워크스페이스 | pnpm-workspace.yaml | services/* |
| 린팅 | ESLint (flat config) | |
| Git 훅 | husky + lint-staged | |
| E2E 테스트 | Playwright | |
| 배포 | Docker Compose | |

---

## 7. 프로젝트 구조

> smart-fire-hub 모노레포 패턴 참고 (pnpm workspace + Turborepo)

```
smart-home-cdn/
├── docs/
│   ├── research-report.md
│   └── architecture.md
├── proto/                              # gRPC 인터페이스 정의
│   ├── storage.proto
│   ├── optimizer.proto
│   ├── dns.proto
│   ├── tls.proto
│   └── proxy.proto
├── services/
│   ├── proxy/                          # Rust - Proxy Service
│   │   ├── Cargo.toml
│   │   ├── Dockerfile
│   │   └── src/
│   ├── storage-service/                # Rust - Storage Service (gRPC :50051)
│   │   ├── Cargo.toml
│   │   ├── Dockerfile
│   │   └── src/
│   ├── tls-service/                    # Rust - TLS Service (gRPC :50052)
│   │   ├── Cargo.toml
│   │   ├── Dockerfile
│   │   └── src/
│   ├── dns-service/                    # Rust - DNS Service (gRPC :50053, UDP :53)
│   │   ├── Cargo.toml
│   │   ├── Dockerfile
│   │   └── src/
│   ├── admin-server/                   # Node.js - Admin API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                # Fastify 엔트리
│   │       ├── routes/                 # REST 엔드포인트
│   │       │   ├── domains.ts
│   │       │   ├── cache.ts
│   │       │   ├── stats.ts
│   │       │   └── settings.ts
│   │       ├── grpc/                   # Rust 서비스 gRPC 클라이언트
│   │       └── db/                     # SQLite 스키마 + 쿼리
│   └── admin-web/                      # React - Dashboard
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api/                    # Axios API 모듈
│           ├── hooks/                  # TanStack Query 훅
│           │   └── queries/            # 도메인별 쿼리 훅
│           ├── lib/                    # 유틸 (validation, formatter)
│           ├── types/                  # TypeScript 인터페이스
│           ├── components/
│           │   ├── ui/                 # shadcn/ui 컴포넌트
│           │   └── layout/             # AppLayout (사이드바 + 헤더)
│           └── pages/                  # lazy-loaded 라우트 페이지
│               ├── DashboardPage.tsx
│               ├── DomainListPage.tsx
│               ├── CachePage.tsx
│               ├── OptimizerPage.tsx
│               └── SettingsPage.tsx
├── package.json                        # 루트 (pnpm workspace + turbo 스크립트)
├── pnpm-workspace.yaml                 # services/*
├── turbo.json                          # build/dev/test/lint 파이프라인
├── docker-compose.yml
├── .husky/                             # Git 훅
├── .eslintrc.js                        # ESLint (flat config)
├── CLAUDE.md
└── README.md
```

### Admin Service 분리 이유

smart-fire-hub과 동일하게 **API 서버와 웹 앱을 별도 워크스페이스**로 분리:
- `admin-server`: Fastify API (독립 빌드/테스트/배포)
- `admin-web`: React Dashboard (Vite 빌드 → 정적 파일)
- 프로덕션: admin-server가 admin-web 빌드 결과물을 정적 서빙
- 개발: 각각 독립 dev 서버 (API: 3001, Web: 5173, Vite proxy로 API 연결)

---

## 8. Dashboard 상세 설계

> smart-fire-hub 프론트엔드 패턴 적용

### 8-1. 페이지 구성

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 대시보드 | `/` | 실시간 트래픽, 캐시 히트율, 대역폭 절감 그래프 |
| 도메인 관리 | `/domains` | 캐싱 대상 도메인 목록/추가/삭제/상태 |
| 도메인 상세 | `/domains/:id` | 도메인별 캐시 통계, 인증서 상태, 원본 서버 설정 |
| 캐시 관리 | `/cache` | 퍼지, 스토리지 사용량, 인기 콘텐츠 목록 |
| 최적화 설정 | `/optimizer` | 이미지 품질/해상도 프로파일 관리 |
| 시스템 | `/settings` | 서비스 상태, 디스크, 로그, CA 인증서 다운로드 |

### 8-2. 프론트엔드 아키텍처 패턴

```
[서버 상태] TanStack Query
  ├── useDomainsQuery()        # 도메인 목록
  ├── useDomainQuery(id)       # 도메인 상세
  ├── useCacheStatsQuery()     # 캐시 통계
  ├── useTrafficQuery()        # 실시간 트래픽
  └── useSystemStatusQuery()   # 서비스 헬스체크

[폼 처리] React Hook Form + Zod v4
  ├── CreateDomainForm         # 도메인 추가 폼
  ├── OptimizerProfileForm     # 최적화 프로파일 편집
  └── SettingsForm             # 시스템 설정

[라우팅] React Router v7
  └── lazy-loaded 페이지 + Suspense 폴백

[HTTP 클라이언트] Axios
  └── /api/* → Admin Server (Vite proxy in dev)
```

### 8-3. UI 컴포넌트 (shadcn/ui 기반)

| 컴포넌트 | 용도 |
|----------|------|
| Card | 대시보드 위젯 (히트율, 대역폭, 스토리지) |
| Table | 도메인 목록, 캐시 엔트리 목록, 인기 콘텐츠 |
| Dialog | 도메인 추가, 퍼지 확인 |
| Badge | 서비스 상태 (온라인/오프라인), 캐시 상태 |
| Tabs | 도메인 상세 (통계/설정/인증서) |
| Chart (Recharts) | 히트율 추이, 트래픽 그래프, 대역폭 절감 |
| Alert | 디스크 부족, 서비스 장애 경고 |

### 8-4. 개발 환경

```
# 개발 시 (각각 독립 실행)
admin-web:    pnpm dev → Vite dev server (4173)
                         vite.config.ts에서 /api/* → localhost:4001 프록시
admin-server: pnpm dev → Fastify (4001)

# 프로덕션 (분리 서버)
admin-server: 4001 포트 (Fastify API)
admin-web:    7777 포트 (nginx — /api/* → admin-server:4001 리버스 프록시)
```

---

## 9. 포트 할당

> smart-fire-hub과 로컬에서 동시 실행 시 충돌 방지

| 서비스 | 포트 | 용도 | 비고 |
|--------|------|------|------|
| Proxy | **443** | iPad HTTPS 요청 수신 | |
| Proxy HTTP (개발) | **8088** | HTTP 프록시 dev | `.env.local` `PROXY_HTTP_PORT=8088` |
| Proxy HTTPS (개발) | **4443** | HTTPS 프록시 dev | `.env.local` `PROXY_HTTPS_PORT=4443` |
| Proxy Admin (개발) | **8089** | Proxy admin API dev | `.env.local` `PROXY_ADMIN_PORT=8089` |
| DNS | **53** (UDP/TCP) | DNS 쿼리 수신 (프로덕션 5353→53) | |
| Admin (프로덕션) | **7777** | Dashboard (Nginx, `WEB_PORT` 환경변수로 변경 가능) | |
| Admin Server (개발) | **4001** | Fastify API dev | smart-fire-hub 3001 회피 |
| Admin Web (개발) | **4173** | Vite dev server | smart-fire-hub 5173 회피 |
| Storage gRPC | **50051** | 내부 통신 | HTTP health :8080 |
| TLS gRPC | **50052** | 내부 통신 | HTTP health :8081 |
| DNS gRPC | **50053** | 내부 통신 | HTTP health :8082 |
| Optimizer gRPC | **50054** | 내부 통신 (미구현) | |
| Proxy gRPC | **50055** | 내부 통신 (미구현) | |

### smart-fire-hub 포트 (참고, 충돌 방지용)

| 포트 | 서비스 |
|------|--------|
| 5432 | PostgreSQL |
| 8080 | Spring Boot API |
| 8090 | (추가 서비스 — 충돌 주의) |
| 8000 | Python Executor |
| 3001 | AI Agent (Node.js) |
| 5173 | firehub-web (Vite dev) |
| 80 | Web 프로덕션 |
| 9998 | Dozzle (로그 뷰어) |

---

## 10. 배포 구성

> smart-fire-hub 패턴 참고: 개발용 / 프로덕션용 docker-compose 분리

### 10-1. docker-compose.yml (개발용)

```yaml
services:
  storage:
    build: ./services/storage
    volumes:
      - cache-data:/data
      - ./data/storage.db:/data/storage.db
    environment:
      - GRPC_PORT=50051
      - CACHE_MAX_SIZE=10g
      - LOG_LEVEL=debug

  proxy:
    build: ./services/proxy
    ports:
      - "443:443"
    volumes:
      - certs:/certs:ro
    environment:
      - STORAGE_GRPC=storage:50051
      - OPTIMIZER_GRPC=optimizer:50053
      - TLS_GRPC=tls:50054
      - LOG_LEVEL=debug
    depends_on: [storage, optimizer, tls]

  optimizer:
    build: ./services/optimizer
    environment:
      - GRPC_PORT=50053
      - DEFAULT_IMAGE_QUALITY=80
      - LOG_LEVEL=debug

  dns:
    build: ./services/dns
    ports:
      - "53:53/udp"
      - "53:53/tcp"
    environment:
      - GRPC_PORT=50052
      - UPSTREAM_DNS=8.8.8.8
      - CACHE_SERVER_IP=host.docker.internal
      - LOG_LEVEL=debug

  tls:
    build: ./services/tls
    volumes:
      - certs:/certs
    environment:
      - GRPC_PORT=50054
      - CA_SUBJECT=Smart Home CDN CA
      - LOG_LEVEL=debug

  admin-server:
    build: ./services/admin-server
    ports:
      - "4001:4001"
    volumes:
      - ./data/admin.db:/data/admin.db
    environment:
      - PORT=4001
      - STORAGE_GRPC=storage:50051
      - DNS_GRPC=dns:50052
      - OPTIMIZER_GRPC=optimizer:50053
      - TLS_GRPC=tls:50054
      - PROXY_GRPC=proxy:50055
      - DB_PATH=/data/admin.db
      - LOG_LEVEL=debug
    depends_on: [storage, dns, tls, proxy]

  # 개발 시에는 admin-web은 Vite dev server로 로컬 실행
  # pnpm --filter admin-web dev

volumes:
  cache-data:
  certs:
```

### 10-2. docker-compose.prod.yml (프로덕션용)

```yaml
services:
  storage:
    image: smart-home-cdn/storage:latest
    restart: always
    volumes:
      - cache-data:/data
      - admin-data:/data/db
    environment:
      - CACHE_MAX_SIZE=${CACHE_MAX_SIZE:-50g}
      - LOG_LEVEL=info

  proxy:
    image: smart-home-cdn/proxy:latest
    restart: always
    ports:
      - "443:443"
    depends_on: [storage, optimizer, tls]

  optimizer:
    image: smart-home-cdn/optimizer:latest
    restart: always

  dns:
    image: smart-home-cdn/dns:latest
    restart: always
    ports:
      - "53:53/udp"
      - "53:53/tcp"
    environment:
      - UPSTREAM_DNS=${UPSTREAM_DNS:-8.8.8.8}
      - CACHE_SERVER_IP=${CACHE_SERVER_IP}

  tls:
    image: smart-home-cdn/tls:latest
    restart: always
    volumes:
      - certs:/certs

  admin:
    image: smart-home-cdn/admin:latest
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - admin-data:/data
    depends_on: [storage, dns, tls, proxy]
    # 프로덕션: admin-web 빌드 결과물을 함께 서빙

volumes:
  cache-data:
  certs:
  admin-data:
```

### 10-3. 루트 스크립트 (package.json)

```json
{
  "scripts": {
    "dev": "turbo dev",
    "dev:infra": "docker compose up -d && turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "test:e2e": "turbo test:e2e --filter=admin-web",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "docker:build": "docker compose -f docker-compose.prod.yml build",
    "docker:up": "docker compose -f docker-compose.prod.yml up -d",
    "docker:down": "docker compose -f docker-compose.prod.yml down",
    "clean": "turbo clean"
  }
}
```

---

## 11. 개발 우선순위

| 순서 | 서비스 | 이유 |
|:----:|--------|------|
| 1 | proto/ (gRPC 인터페이스) | 서비스간 계약을 먼저 정의 |
| 2 | Storage Service (Rust) | 캐시의 핵심, 다른 서비스가 의존 |
| 3 | Proxy Service (Rust) | 핵심 기능 - 요청 수신/캐시/원본 요청 |
| 4 | TLS Service (Rust) | Proxy가 HTTPS 서빙에 필요 |
| 5 | DNS Service (Rust) | iPad 연동에 필요 |
| 6 | Optimizer Service (Rust) | 부가 기능, 나중에 추가 가능 |
| 7 | Admin Service (Node.js) | API + Dashboard, 비즈니스 로직 |
