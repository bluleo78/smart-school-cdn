# Smart School CDN 개발 로드맵

> 작성일: 2026-04-11
> 기반 문서: `docs/architecture.md`, `docs/guides/user-guide.md`
> 원칙:
> - **단순 프록시에서 출발하여 기능을 하나씩 붙여 완성한다**
> - **매 Phase마다 동작하는 시스템을 유지한다**
> - **매 Phase마다 Admin Web UI를 함께 만들어 브라우저에서 검증한다**

---

## Phase 0: 개발 환경 + 기본 UI 셸

> 목표: 모노레포 빌드 + 빈 Dashboard 렌더링

### 0-1. 루트 모노레포 설정
- [x] `package.json` (pnpm workspace root, turbo 스크립트)
- [x] `pnpm-workspace.yaml` (`services/*`)
- [x] `turbo.json` (build/dev/test/lint 파이프라인)
- [x] `.npmrc`
- **검증**: `pnpm install` 성공 ✅

### 0-2. Rust 워크스페이스
- [x] 루트 `Cargo.toml` (workspace members)
- [x] `services/proxy/` — 최소 crate (tokio + 시작 로그)
- **검증**: `cargo build --workspace` 성공 ✅

### 0-3. Admin Server 스캐폴딩
- [x] `services/admin-server/` (Fastify + TypeScript)
- [x] `GET /api/health` → `{ status: "ok" }`
- **검증**: `pnpm --filter admin-server dev` → `localhost:4001/api/health` 200 OK ✅

### 0-4. Admin Web 스캐폴딩
- [x] `services/admin-web/` (Vite + React 19 + TypeScript)
- [x] Tailwind CSS v4 + shadcn/ui (new-york) 초기 설정
- [x] AppLayout (사이드바 + 헤더)
- [x] React Router v7 페이지 라우팅 (대시보드, 도메인, 캐시, 최적화, 시스템)
- [x] `vite.config.ts` — `/api/*` → `localhost:4001` 프록시
- **검증**: 브라우저 `localhost:4173` → 사이드바 + 빈 대시보드 페이지 렌더링 ✅

### 0-5. 린팅 / Git 훅
- [x] ESLint flat config + Rust clippy
- [x] `.husky/pre-commit` + `lint-staged`
- **검증**: 린트 에러 코드 → `git commit` 차단 ✅

---

## Phase 1: HTTP 리버스 프록시 + 요청 모니터링 UI

> 목표: 프록시가 요청을 중계하고, Dashboard에서 요청 흐름을 실시간 확인
> 아직 HTTPS 아님, 캐시 없음, DNS 없음. 순수 리버스 프록시만.

### 1-1. 단순 리버스 프록시
- [x] Proxy Service — axum HTTP 서버 (포트 8080)
- [x] `Host` 헤더 기반 원본 서버 요청 전달 → 응답 반환
- [x] 설정 파일에 프록시 대상 도메인 → 원본 서버 매핑
- [x] `X-Cache-Status: BYPASS`, `X-Served-By: smart-school-cdn` 헤더 추가

### 1-2. Admin API — 프록시 상태/로그
- [x] `GET /api/proxy/status` — 프록시 온라인 상태, 업타임
- [x] `GET /api/proxy/requests` — 최근 요청 로그 (URL, 상태코드, 응답시간)

### 1-3. Dashboard — 대시보드 페이지 (v1)
- [x] 프록시 상태 카드 (온라인/오프라인 배지, 업타임)
- [x] 최근 요청 로그 테이블 (URL, 상태, 응답시간, 타임스탬프)
- [x] 실시간 요청 카운터
- [x] 도메인 관리 페이지 — 프록시 경유 테스트 (도메인+경로 입력 → 결과 표시)

### 검증
> 브라우저에서 대시보드 열기 → 별도 터미널에서 프록시를 통해 요청 발생
> → 대시보드에 요청 로그가 실시간 표시, 상태 "온라인", 모든 요청 `BYPASS`
> 도메인 관리 페이지 → 테스트 버튼 → HTTP 200 + 응답시간 확인 ✅

---

## Phase 2: 캐시 기능 + 캐시 통계 UI

> 목표: 캐시 HIT/MISS가 동작하고, Dashboard에서 히트율/용량을 확인

### 2-1. 디스크 캐시
- [x] 요청 URL → 해시 키 → 로컬 파일 저장
- [x] 캐시 HIT → `X-Cache-Status: HIT`, MISS → 원본 fetch + 저장 + `X-Cache-Status: MISS`
- [x] Cache-Control / ETag / Last-Modified 처리
- [x] max_size 설정 + LRU 퇴거

### 2-2. Admin API — 캐시 관리
- [x] `GET /api/cache/stats` — 히트율, 총 용량, 사용량, 도메인별 통계
- [x] `DELETE /api/cache/purge` — URL별/도메인별/전체 퍼지
- [x] `GET /api/cache/popular` — 인기 콘텐츠 목록

### 2-3. Dashboard — 대시보드 페이지 (v2) + 캐시 관리 페이지
- [x] 대시보드: 캐시 히트율 카드 + 대역폭 절감 카드 + Recharts 히트율 추이 그래프
- [x] 대시보드: 스토리지 사용량 프로그레스 바
- [x] 캐시 관리 페이지: 퍼지 UI (URL/도메인/전체) + 확인 다이얼로그
- [x] 캐시 관리 페이지: 인기 콘텐츠 테이블

### 검증
> 프록시를 통해 동일 URL 2회 요청 → 대시보드에서 히트율 50% 표시, MISS 1 / HIT 1
> 캐시 관리 페이지에서 도메인별 퍼지 → "퍼지 완료" 토스트 → 스토리지 사용량 감소 반영
> 반복 요청 → 히트율 그래프 상승 추이 확인

---

## Phase 3: 운영 환경 구성

> 목표: Phase 2까지 구현된 프록시 + 캐시를 실제 서버에 배포 가능한 상태로 만든다

### 3-1. Docker Compose 운영 구성
- [x] `docker-compose.prod.yml` — Proxy(8080), Admin Server(3000), Admin Web 정적 빌드 포함 (`~/prod/smart-school-cdn/`)
- [x] Admin Server가 프로덕션에서 Admin Web 빌드 결과물(dist/)을 정적 서빙 (Nginx 경유)
- [x] `.env.example` — `CACHE_DIR`, `CACHE_MAX_SIZE_GB`, `PROXY_ADMIN_URL`, `PORT` 등

### 3-2. 컨테이너 안정성
- [x] 모든 서비스에 `restart: always` 적용
- [x] Proxy 헬스체크 (`/status` 엔드포인트) Docker HEALTHCHECK 등록
- [x] 캐시 디렉터리를 named volume으로 마운트하여 재시작 시 데이터 유지

### 3-3. Dashboard — 시스템 페이지 (v1)
- [x] 디스크 사용량 경고 배너 (캐시 사용량 90% 이상 시 표시)
- [x] 서버 업타임 표시 (기존 ProxyStatus.uptime 활용)

### 검증
> `docker compose -f docker-compose.prod.yml up -d` → `http://<서버IP>:3000` 대시보드 접속
> 프록시를 통해 요청 → HIT/MISS 통계 표시
> 컨테이너 강제 종료 → 30초 이내 자동 재시작

---

## Phase 4: HTTPS 지원 + 인증서 관리 UI

> 목표: 자체 CA로 HTTPS 프록시 동작, Dashboard에서 인증서 다운로드/상태 확인

### 4-1. 자체 CA + HTTPS 프록시
- [x] 서버 시작 시 CA 키 쌍 생성 (rcgen), 영속화
- [x] 프록시 대상 도메인별 서버 인증서 자동 발급
- [x] axum HTTPS 서버 (포트 443) + SNI 기반 인증서 선택
- [x] CA 다운로드용 HTTP 엔드포인트 유지 (포트 8080)

### 4-2. Admin API — 인증서 관리
- [x] `GET /api/tls/ca` — CA 인증서 다운로드 (.crt)
- [x] `GET /api/tls/ca/mobileconfig` — iOS 프로파일 다운로드
- [x] `GET /api/tls/certificates` — 발급된 인증서 목록 (도메인, 만료일, 상태)

### 4-3. Dashboard — 시스템 페이지 (v2)
- [x] CA 인증서 다운로드 버튼 (.crt + .mobileconfig)
- [x] 인증서 목록 테이블 (도메인, 발급일, 만료일, 상태 배지)
- [x] CA 설치 안내 문구 (iPad 수동 설치 / MDM 배포 가이드 링크)

### 검증
> 대시보드 시스템 페이지 → CA 인증서 다운로드 클릭 → 유효한 .crt 파일 저장
> iPad Safari에서 `http://<CDN-IP>:8080/ca.mobileconfig` → 프로파일 설치 화면
> CA 신뢰 후 `https://cdn.textbook.com` 정상 접속 (프록시 경유)

---

## Phase 5: DNS 서비스 + 도메인 관리 UI

> 목표: DNS까지 연결하여 태블릿 투명 프록시 완성. Dashboard에서 도메인 CRUD.
> **핵심 파이프라인 완성: DNS → HTTPS Proxy → 캐시**

### 5-1. DNS 서버
- [x] hickory-dns 기반 DNS 서버 (포트 53)
- [x] 미등록 도메인 → upstream DNS 포워딩
- [x] 등록 도메인 → CDN 서버 IP 반환 + 와일드카드 지원

### 5-2. Admin API — 도메인 관리
- [x] `POST /api/domains` — 도메인 추가 → DNS 오버라이드 + 인증서 발급
- [x] `GET /api/domains` — 목록 (DNS 상태, 인증서 상태 포함)
- [x] `DELETE /api/domains/:id` — 삭제 → DNS 해제 + 인증서 제거
- [x] `GET /api/domains/:id` — 상세 (캐시 통계, 인증서 정보)

### 5-3. Dashboard — 도메인 관리 페이지
- [x] 도메인 목록 테이블 (도메인명, DNS 상태, 인증서 상태, 캐시 사용량)
- [x] 도메인 추가 다이얼로그 (React Hook Form + Zod v4 검증)
- [x] 도메인 삭제 확인 다이얼로그
- [x] 도메인 상세 페이지 (캐시 통계 탭, 인증서 정보 탭)

### 검증 (전체 E2E)
> 대시보드에서 `cdn.textbook.com` 도메인 추가 → 목록에 "활성" 배지 표시
> `dig @<CDN-IP> cdn.textbook.com` → CDN IP 응답
> `dig @<CDN-IP> auth.textbook.com` → 원본 IP 응답 (바이패스)
> 태블릿 DNS를 CDN으로 설정 → 교과서 앱에서 콘텐츠 로딩 → 대시보드에 HIT/MISS 통계 반영
> 도메인 상세 페이지에서 캐시 히트율, 트래픽 확인
> 도메인 삭제 → DNS 오버라이드 해제 → `dig` 원본 IP 응답

---

## Phase 5.5: Admin Web 디자인 시스템 통합 + UX 개선

> 목표: 전 페이지에 일관된 디자인 시스템 적용. Tailwind v4 @theme 토큰, 공통 UI 컴포넌트 라이브러리, UX 결함 수정.

### 5.5-1. 디자인 토큰 + 공통 유틸리티
- [x] `index.css` — Tailwind v4 `@theme` 블록으로 시맨틱 CSS 변수 정의
- [x] `lib/utils.ts` — `cn()` 유틸리티 (clsx + tailwind-merge)
- [x] `lib/format.ts` — `formatUptime()` 공유 유틸리티 (중복 제거)
- [x] `sonner` 설치 — 통합 토스트 알림

### 5.5-2. UI 컴포넌트 라이브러리
- [x] `Card`, `CardHeader`, `CardContent`, `CardTitle` — 시맨틱 토큰 적용
- [x] `Dialog` — ESC 키 + 배경 클릭으로 닫기
- [x] `AlertDialog` — 삭제 확인 전용
- [x] `Input`, `Table`, `Skeleton` — 시맨틱 토큰 적용

### 5.5-3. App 셸 + AppLayout
- [x] `App.tsx` — `<Toaster />` 마운트 + 404 폴백 라우트
- [x] `AppLayout.tsx` — 시맨틱 토큰으로 전면 교체

### 5.5-4. DashboardPage + 카드 컴포넌트
- [x] `ProxyStatusCard`, `CacheHitRateCard`, `BandwidthCard`, `StorageUsageCard` — 에러 상태 표시 + 시맨틱 토큰
- [x] `DashboardPage` — 반응형 그리드 + 공통 컴포넌트 적용

### 5.5-5. SystemPage 마이그레이션
- [x] 시맨틱 토큰 전면 적용, `formatUptime` 공유 유틸 사용

### 5.5-6. CachePage 마이그레이션
- [x] 시맨틱 토큰 + 공통 컴포넌트 적용, 퍼지 성공 토스트

### 5.5-7. DomainsPage 마이그레이션 + UX 개선
- [x] 추가/삭제 성공 토스트, API 에러 표시
- [x] 사이드 패널 `AlertDialog` 기반 삭제 확인
- [x] 시맨틱 토큰 전면 적용

### 5.5-8. 차트/테이블 컴포넌트 + 최종 검증
- [x] `CacheHitRateChart`, `RequestLogTable` 시맨틱 토큰 적용
- [x] E2E 전체 통과 확인

### 검증
> 브라우저에서 전 페이지 일관된 디자인 확인
> 도메인 추가/삭제 → 토스트 알림 표시
> 다이얼로그 ESC·배경 클릭으로 닫히는지 확인
> API 에러 → 에러 메시지 (false zero 없음)
> 404 경로 접근 → 폴백 페이지 표시
> `pnpm test:e2e` → 전체 E2E 통과

---

## Phase 6: 서비스 분리 + 서비스 헬스체크 UI

> 목표: 모놀리식 → 마이크로서비스 리팩터링. 기능 변화 없음.
> Dashboard에서 각 서비스 상태를 개별 모니터링.

### 6-1. Storage Service 분리
- [x] `proto/storage.proto` (Get, Put, Delete, Purge, Stats)
- [x] Proxy 내부 캐시 → Storage Service (tonic gRPC)로 추출
- [x] Proxy → Storage gRPC 통신

### 6-2. TLS Service 분리
- [x] `proto/tls.proto` (CreateCA, IssueCert, GetCert, GetCACert)
- [x] Proxy 내부 인증서 → TLS Service로 추출

### 6-3. DNS Service 분리
- [x] `proto/dns.proto` (AddDomain, RemoveDomain, ListDomains)
- [x] DNS → 독립 서비스, 도메인 목록 gRPC 동적 관리

### 6-4. Docker Compose
- [x] `docker-compose.yml` 서비스 구성 + gRPC 네트워크

### 6-5. Admin API — 서비스 헬스체크
- [x] `GET /api/system/status` — 각 서비스(Proxy, Storage, DNS, TLS) 개별 상태
- [x] Admin Server → 각 서비스 gRPC 헬스체크 호출

### 6-6. Dashboard — 시스템 페이지 (v3)
- [x] 서비스별 상태 카드 (Proxy, Storage, DNS, TLS — 각각 온라인/오프라인 배지)
- [x] 서비스 응답시간 표시
- [x] 서비스 장애 시 알림 배너

### 검증
> **Phase 5의 전체 E2E가 동일하게 통과** (기능 변화 없음)
> 대시보드 시스템 페이지 → 4개 서비스 모두 "온라인" 배지
> Storage 서비스 중지 → 해당 카드 "오프라인" 전환 + 알림 배너 표시
> Storage 재시작 → "온라인" 복구
> `docker compose ps` → 모든 서비스 Running

---

## Phase 7: 콘텐츠 최적화 + 최적화 설정 UI ✅

> 목표: 이미지 최적화 통합, Dashboard에서 최적화 프로파일 관리 + 절감 효과 확인

### 7-1. Optimizer Service
- [x] `proto/optimizer.proto` (Optimize, GetProfiles, SetProfile)
- [x] PNG/JPEG → WebP 변환 + 리사이즈 + 품질 조정 *(Phase 14에서 포맷 보존 + libwebp + size-guard로 개편)*
- [x] Proxy가 캐시 MISS 시 Optimizer 경유 후 저장
- [x] 이미 최적화된 포맷(WebP, AVIF) 바이패스
- [ ] ~~텍스트 압축 (gzip/brotli)~~ → **Phase 15로 이관** (스펙·구현 모두 당시엔 미착수)

### 7-2. Admin API — 최적화 관리
- [x] `GET /api/optimizer/profiles` — 프로파일 목록
- [x] `PUT /api/optimizer/profiles/:id` — 프로파일 수정 (품질, 해상도, 포맷)
- [x] `GET /api/stats/optimization` — 최적화 절감 통계 (원본 크기 vs 최적화 크기)

### 7-3. Dashboard — 최적화 페이지 + 대시보드 (v3)
- [x] 최적화 프로파일 편집 폼 (품질 슬라이더, 최대 해상도, 포맷 선택)
- [x] 최적화 절감 통계 카드 (원본 총 용량 vs 최적화 후 용량, 절감률)
- [x] 대시보드에 최적화 절감 카드 추가

### 검증
> 최적화 페이지에서 프로파일 "tablet" 설정 (WebP, 80%, max 2048px)
> 프록시를 통해 2MB PNG 요청 → 대시보드에서 최적화 절감 표시 (원본 2MB → 최적화 ~300KB)
> 최적화 페이지에서 품질 60%로 변경 → 재요청 → 용량 추가 감소 확인
> 이미 WebP인 이미지 → 변환 없이 통과 (절감 0%) ✅

---

## Phase 8: 고급 기능 ✅

> 목표: 운영 품질 향상 기능

### 8-1. 동시 요청 병합 (Request Coalescing)
- [x] 같은 URL 동시 요청 시 원본에 1회만 요청
- **검증**: 부하 테스트 도구로 동일 URL 동시 50개 → 원본 서버 로그 1회, 대시보드 트래픽 50건 표시

### 8-2. 메모리 캐시 레이어
- [x] 핫 콘텐츠 메모리 캐시 (디스크 위 2단 캐시)
- **검증**: 대시보드에서 메모리/디스크 캐시 비율 표시, 인기 콘텐츠가 메모리 캐시로 승격됨을 확인

### 8-3. 로그 뷰어
- [x] Dashboard 시스템 페이지에 실시간 로그 뷰어 추가
- **검증**: 대시보드에서 각 서비스 로그를 실시간 스트리밍으로 확인

---

## Phase 9: E2E 테스트 자동화

> 목표: 전체 시스템 자동화 검증

### 9-1. Playwright E2E 테스트
- [x] 도메인 추가 → 캐시 생성 → 퍼지 → 통계 확인 시나리오
- [x] 인증서 다운로드 시나리오 (system.spec.ts 커버)
- [x] 최적화 프로파일 변경 시나리오 (optimizer.spec.ts 커버)
- **검증**: `pnpm test:e2e` → 전체 55개 통과 ✅ (Phase 10에서 캐시/최적화 페이지 제거 후 테스트 재편)

### 9-2. 인프라 통합 테스트
- ~~Docker Compose 전체 기동 → DNS → HTTPS → 캐시 → Dashboard 반영~~ (제외)

---

## Phase 10: 도메인 관리 재설계 + 메뉴 통합 ✅

> 목표: 도메인 관리 UI를 전면 재설계하고, 캐시/최적화를 도메인 상세로 흡수하여 메뉴를 3개로 축소

### 10-1. 도메인 DB 스키마 확장
- [x] `domains` 테이블에 `enabled`, `description`, `updated_at` 컬럼 추가
- [x] `domain_stats` 시계열 통계 테이블 생성
- [x] 운영 DB 자동 마이그레이션 (ALTER TABLE + CREATE TABLE)

### 10-2. 도메인 API 확장 (12개 엔드포인트)
- [x] 검색/필터 (`GET /api/domains?q=&enabled=&sort=`)
- [x] 단일 조회 (`GET /api/domains/:host`), 편집 (`PUT`), 토글 (`POST /:host/toggle`)
- [x] 캐시 퍼지 (`POST /:host/purge`), 일괄 추가/삭제 (`POST/DELETE /api/domains/bulk`)
- [x] 도메인별 통계 (`GET /:host/stats`), 로그 (`GET /:host/logs`), 전체 요약 (`GET /summary`)
- [x] 동기화 실패 시 에러 전파 (기존: 로그만 → 변경: 502 에러)

### 10-3. 도메인 목록 페이지 전면 교체
- [x] 요약 통계 카드 4개 (스파크라인 내장)
- [x] 알림 배너 (TLS 만료 임박, 동기화 실패)
- [x] 도구 모음 (검색/필터/일괄추가/일괄삭제)
- [x] 테이블 (체크박스, 상태 배지, 인라인 액션)
- [x] 기존 사이드패널 제거

### 10-4. 도메인 상세 페이지 (신규, 3탭)
- [x] `/domains/:host` 라우팅 추가
- [x] Overview 탭: 기본 정보 + 동기화/TLS 상태 + 통계 카드 + Quick Actions
- [x] 통계 탭: 기간별 차트 + 인기 콘텐츠 + 최적화 절감 통계 + 로그 테이블
- [x] 설정 탭: Origin 편집 + 캐시 퍼지 + 최적화 프로파일 + TLS 정보 + 삭제

### 10-5. 메뉴 통합 (5개 → 3개)
- [x] 캐시 관리 페이지 → 대시보드(글로벌 통계) + 도메인 상세(도메인별 퍼지) 로 분산
- [x] 최적화 페이지 → 도메인 상세 설정 탭으로 흡수
- [x] 대시보드에 캐시 통계 카드 + 인기 콘텐츠 Top5 추가
- [x] `/cache`, `/optimizer` → `/domains` 리다이렉트
- [x] CachePage.tsx, OptimizerPage.tsx 삭제

### 10-6. Proxy 변경
- [x] `enabled` 필드 처리 (비활성 도메인 도메인 맵에서 제외)
- [x] `POST /domains/:host/purge` 캐시 퍼지 엔드포인트

### 10-7. 도메인 추가 시 최적화 프로파일 자동 생성
- [x] 단일/일괄 추가 시 Optimizer에 기본 프로파일 생성 (quality=85, max_width=0, enabled=true)

### 검증
> 도메인 목록: 카드+검색+필터+테이블 렌더링, 일괄 추가/삭제 동작
> 도메인 상세: 3탭 전환, 편집, 캐시 퍼지, 최적화 프로파일 저장
> 메뉴: 3개만 표시, /cache·/optimizer → /domains 리다이렉트
> E2E 55개 통과, 빌드 성공, 운영 배포 완료 ✅

---

## Phase 11: 기능 완성 + 운영 품질 향상 ✅

> 목표: 통계 파이프라인 구축, TLS 실시간 상태, delta 계산, Quick Actions 활성화, E2E 커버리지 복원

### 11-1. 통계 파이프라인 (Proxy → Admin pull)
- [x] Proxy: 도메인별 AtomicU64 카운터 + GET /stats 엔드포인트 (swap 리셋)
- [x] Admin: 1분 간격 폴링 타이머 (stats-collector.ts) → domain_stats 저장
- [x] SQLite PRAGMA foreign_keys = ON 활성화

### 11-2. Delta 계산
- [x] getSummaryAll(): 전일 대비 요청 수/히트율 변화율 계산
- [x] getStats(): 이전 동일 기간 대비 요청/히트율/응답시간 변화율 계산
- [x] summary/stats API에서 하드코딩 0 → 실제 delta 값 반영

### 11-3. TLS 실시간 상태 + Quick Actions
- [x] POST /api/tls/renew/:host — TLS 갱신 API
- [x] POST /api/domains/:host/sync — Proxy/TLS/DNS 강제 동기화 API
- [x] DomainInfoCards: useDomainTls 훅으로 실시간 TLS 상태 (유효/임박/만료/미발급)
- [x] DomainQuickActions: 이모지 → Lucide 아이콘 + TLS 갱신/강제 동기화 활성화

### 11-4. 코드 품질 수정
- [x] POST /api/domains: syncToProxy 실패 시 502 에러 전파
- [x] GET /:host/logs: SELECT * → 명시적 컬럼 (timestamp, status_code, cache_status, path, size)
- [x] DomainLogTable: 50건 기본 + "더 보기" 페이지네이션

### 11-5. E2E 테스트 복원 (55 → 68)
- [x] 도메인 상세 E2E 10건 (Overview/통계/설정 탭 + Quick Actions)
- [x] 대시보드 캐시 카드 E2E 3건 (통계 + 인기 콘텐츠 + 전체 퍼지)

### 검증
> lint 0 errors, build 성공, proxy test 47개 통과
> E2E 68개 통과, Lines 커버리지 63% → 83% ✅

---

## Phase 12: 캐시 통계 레이어 재설계 ✅

> 목표: 단일 HIT/MISS 지표를 L1/L2/bypass 4분류로 분리하고 스택 차트·도메인별 표로 재구성. 운영에서 "어디서 얼마나 바이패스되는지" 가시화.

### 12-1. Proxy outcome 분류
- [x] `CacheOutcome` enum + 순수 함수 `classify_outcome` (L1 hit, L2 hit, Bypass_*, Miss)
- [x] 요청 경로에 outcome 계산 주입 + `X-Cache-Reason` 응답 헤더 추가
- [x] `DomainCounters` 확장 — L1/L2/bypass 4분류 AtomicU64 + `record_domain_outcome`

### 12-2. 컨텐츠 화이트리스트·크기 상한 조정
- [x] 컨텐츠 타입 화이트리스트 확대 (동영상 등)
- [x] 캐시 엔트리 크기 상한 상향 (128MB), 중복 파서 제거

### 12-3. Admin 통계 파이프라인 재작성
- [x] `domain_stats` 테이블에 L1/L2/bypass 4분류 컬럼 마이그레이션
- [x] `/api/cache/stats` 재작성 — domain_stats 집계 + 디스크 분리
- [x] `/api/cache/series` 신규 — 스택 차트용 버킷 시계열
- [x] 도메인 stats/summary에 L1/L2/bypass 비율 포함

### 12-4. 대시보드 시각화
- [x] L1/L2/bypass 스택 차트
- [x] 도메인별 요청·히트율·4분류 비율 표

### 검증
> proxy test outcome 분류·X-Cache-Reason 헤더 통합 테스트 녹색
> 머지 커밋 `65b1df6` (feat/cache-stats-redesign)

---

## Phase 13: 미디어 Range 캐싱 + 관찰 인프라 ✅

> 목표: 비디오/오디오 Range 요청 대응 + Phase 7 이후 비어있던 최적화 관찰 파이프라인 구축. Cache-Control no-store override로 정적 확장자 캐시 복구.

### 13-1. HTTP Range 슬라이싱
- [x] `services/proxy/src/range.rs` — `ByteRange` enum, `parse_byte_range`/`resolve_range`/`format_content_range*`
- [x] L1/L2/MISS 전 경로에서 `Bytes::slice` 제로카피 범위 응답 (206 Partial Content, 416 Range Not Satisfiable)
- [x] 단일 range만 지원, multi-range는 파서 단계에서 reject → 호출자 200 fallback

### 13-2. 정적 확장자 no-store override
- [x] `is_static_extension` 화이트리스트 (mp4/mp3/png/js/css 등)
- [x] origin의 `Cache-Control: no-store`에도 불구하고 정적 확장자는 캐시 저장 허용

### 13-3. 관찰 인프라 (optimization_events)
- [x] admin-server — `optimization_events` SQLite 테이블 + 마이그레이션
- [x] admin-server — `POST /internal/events/batch` (proxy 전용) + `GET /api/optimization/events`/`GET /api/optimization/stats`
- [x] proxy — `services/proxy/src/events.rs` 배치 push 모듈 (mpsc + 5s flush interval)
- [x] proxy — 미디어 MISS/HIT 경로에서 `media_cache` 이벤트 발행 (`l1_hit_206`, `miss_416` 등 decision 스킴)

### 검증
> proxy 테스트 62 → 100개, admin-server 테스트 148 → 175개
> 머지 커밋 `de94190` (feat/phase-13-media-range)

---

## Phase 14: 이미지 Optimizer 포맷 보존 + 리사이즈 전면화 ✅

> 목표: `image` 크레이트 WebP lossless-only 회귀 해소. 포맷을 유지(JPEG→JPEG, PNG→PNG, WebP→WebP)하며 `profile.quality`를 실제 적용하고 size-guard로 역효과를 방지. `image_optimize` 이벤트로 관찰 파이프라인 연결.

### 14-1. 크레이트 + Dockerfile
- [x] `image` 0.25 features 확장 (`gif`, `bmp`, `tiff` 추가)
- [x] `webp = "0.3"` (libwebp 래퍼) 신규
- [x] `oxipng = "9"` (pure Rust lossless PNG 재압축) 신규
- [x] optimizer-service Dockerfile — alpine `libwebp-dev`/`libwebp` + `pkgconfig`

### 14-2. 순수 인코더 모듈 (`services/optimizer-service/src/encoder.rs`)
- [x] `encode_jpeg(img, quality)` — image::JpegEncoder::new_with_quality
- [x] `encode_png(img)` — image PngEncoder 1차 → oxipng(level 4, strip=Safe) 재압축
- [x] `encode_webp_lossy(img, quality)` — libwebp
- [x] `encode_webp_lossless(img)` — libwebp bit-exact 라운드트립
- [x] 단위 테스트 12개 (시그니처/차원/quality 비교/bit-exact)

### 14-3. optimize_preserving_format + size-guard
- [x] `OptimizeDecision` enum — Optimized / PassthroughLarger / PassthroughError / PassthroughUnsupported
- [x] 6개 content_type 디스패치: JPEG→JPEG, PNG→PNG, WebP→WebP(lossy), GIF(정지)/BMP/TIFF→WebP lossless
- [x] animated GIF 선제 감지 (2번째 프레임 존재 여부)
- [x] size-guard: `encoded.len() >= data.len()` 이면 원본 반환
- [x] enabled=false 프로파일 → `decision=None` (관찰 대상 X)

### 14-4. gRPC + proxy 연결
- [x] proto `OptimizeResponse.decision` optional 필드 추가 (하위 호환)
- [x] grpc.rs — `OptimizeDecision::as_str()` → 문자열 전파
- [x] proxy `should_optimize` 6종으로 확장
- [x] proxy MISS 경로에서 `image_optimize` 이벤트 발행 (decision/orig/out/elapsed_ms)

### 검증
> optimizer-service 테스트 15 → 36개 (encoder 12 + optimizer 14 + grpc 10)
> proxy 100개 전부 녹색
> 운영 배포 완료 (optimizer-service 먼저 → proxy 나중, `webdt.edunet.net` 반영)

---

## 마일스톤 요약

| Phase | 이름 | 누적 기능 | 대시보드 검증 |
|:-----:|------|----------|-------------|
| 0 | 개발 환경 | 빌드 가능 | 빈 대시보드 렌더링 |
| 1 | HTTP 프록시 | 요청 중계 | 요청 로그 실시간 표시 |
| 2 | + 캐시 | HIT/MISS | 히트율 그래프 + 퍼지 UI |
| 3 | 운영 환경 구성 | Docker Compose prod | prod 환경에서 전체 동작 |
| 4 | + HTTPS | 자체 CA | 인증서 다운로드 + 상태 확인 |
| 5 | + DNS | **핵심 파이프라인 완성** | 도메인 CRUD + 전체 E2E |
| 5.5 | Admin Web 디자인 시스템 | 일관된 UI + UX 개선 | 전 페이지 디자인 통합 + 토스트 + 에러 상태 |
| 6 | 서비스 분리 | 마이크로서비스 | 서비스별 헬스체크 카드 |
| 7 | + 최적화 | 이미지 WebP | 프로파일 편집 + 절감 통계 |
| 8 | + 고급 기능 | 요청 병합, 로그 | 메모리 캐시 비율 + 로그 뷰어 |
| 9 | E2E 테스트 | 자동화 검증 | Playwright 전 시나리오 통과 |
| 10 | 도메인 재설계 + 메뉴 통합 | 풍부한 도메인 관리 + 3개 메뉴 | 목록+상세(3탭) + 캐시/최적화 흡수 |
| 11 | 기능 완성 + 운영 품질 | 통계 파이프라인 + TLS 실시간 | E2E 68개 + 커버리지 83% |
| 12 | 캐시 통계 재설계 | L1/L2/bypass 4분류 + 스택 차트 | 도메인별 비율 + X-Cache-Reason |
| 13 | 미디어 Range + 관찰 인프라 | 206/416 + no-store override + optimization_events | decision 4종 수집 가능 |
| 14 | Optimizer 포맷 보존 | JPEG/PNG/WebP 포맷 유지 + size-guard + libwebp | `image_optimize` 이벤트 발행 |
| 15 | 텍스트 Brotli 프리컴프레스 | HTML/JS/CSS level 11 + Accept-Encoding 협상 + size-guard | `text_compress` 이벤트 발행 |

---

## Phase 15: 텍스트 Brotli/gzip 프리컴프레스 — 완료 (2026-04-19)

> 목표: HTML/CSS/JS/JSON/SVG 등 텍스트 응답에 Brotli 또는 gzip 프리컴프레스 적용. `Accept-Encoding` 협상 지원. Phase 7에서 체크됐으나 실제로는 미구현된 항목을 정식 페이즈로 분리.

### 15-1. 범위
- 대상 content_type: `text/html`, `text/css`, `application/javascript`, `application/json`, `image/svg+xml`, `text/plain`, `application/xml`
- 압축 알고리즘: **Brotli 우선 + gzip 폴백**
- Accept-Encoding 협상 — 클라이언트 미지원 시 원본 전달
- 캐시 저장 단위: 압축본 + 원본 둘 다 저장 vs 원본만 저장 후 응답 시 압축 (설계 결정 필요)

### 15-2. 구현 포인트 (초안)
- optimizer-service 역할 vs proxy 역할 분리 재검토 — 현재 이미지만 담당하는 optimizer에 텍스트까지 맡길지, proxy에서 직접 압축할지
- `should_optimize`/`should_compress` 분리 — 이미지 판정과 텍스트 판정이 서로 다른 content_type 화이트리스트
- size-guard — 작은 텍스트(< 수백 바이트)는 압축 이득보다 오버헤드가 크므로 최소 크기 기준
- Phase 13 관찰 인프라에 `text_compress` 이벤트 발행 (`optimization_events.event_type` 화이트리스트에 이미 포함)

### 15-3. 비목표
- 이미 `Content-Encoding`이 붙은 응답 재압축 (이중 압축 방지)
- 스트리밍 응답 압축 (현재 응답 버퍼링 가정)

### 15-4. 설계 결정 (2026-04-19 브레인스토밍 확정)
- 실행 주체: **proxy 직접 압축** (optimizer-service 경유 X) — 텍스트는 순수 CPU 작업이라 gRPC 왕복 불필요
- 캐시 저장: **원본 + brotli 변형 둘 다 저장** — pre-compress 비용을 MISS 1회에 분할상환
- 압축 레벨: **Brotli level 11** (pre-compress), 드문 미지원 클라이언트엔 저장된 br을 decompress 후 **gzip level 6** on-demand 폴백
- 판별 규칙: 엄격 화이트리스트 + 원본 ≥ 1024 bytes + 응답에 `Content-Encoding` 존재 시 스킵 + 압축 후 > 원본×0.9면 스킵(size-guard)
- 파라미터 관리: **환경변수만** (`TEXT_COMPRESS_ENABLED`, `TEXT_COMPRESS_MIN_BYTES`, `TEXT_COMPRESS_BR_LEVEL`, `TEXT_COMPRESS_GZIP_LEVEL`) — Admin UI/API는 Phase 18로 연기

### 오픈 이슈
- proxy 메모리 사용량 (압축 시 추가 버퍼) — Phase 15 배포 후 관찰

---

## Phase 16 (차기 착수): 프록시 운영 품질 개선 + 도메인 상세 UX 재배치

> 목표: Phase 15 배포 직후 실측으로 드러난 운영 이슈 두 건과 도메인 상세 페이지의 정보 구조 개선을 함께 묶어 처리한다. 관찰·튜닝성 후보 페이즈(17~19)와 달리 **즉시 착수 예정**.

### 16-1. MISS 경로 TTFB 개선 (백그라운드 저장)

**배경**
- 현재 MISS 경로는 `origin fetch → optimize/brotli → storage.put → L1 insert → 응답` 순으로 블로킹. Phase 15 Brotli level 11은 수십~수백 ms, 큰 JS는 초 단위까지 지연.
- 첫 요청자 TTFB = `origin_time + optimize/compress_time + storage_put_time` 누적.

**채택 방향: Option A' — 백그라운드 spawn + 진행 중 키 레지스트리**
- coalescer 클로저는 `origin fetch` 직후 **원본 body 즉시 반환**
- `tokio::spawn`으로 background task: optimize/compress + storage.put + L1 insert
- 진행 중 키 레지스트리(`Arc<Mutex<HashSet<String>>>`)로 동일 URL 2차 MISS가 **중복 origin fetch/저장을 수행하지 않도록 gate**
- 2차 요청은 저장 완료 대기 옵션 또는 단순 원본 pass-through 중 구현 시점에 결정

**검증**
- 텍스트 응답의 MISS TTFB 실측(p50/p95) 50%+ 단축 목표
- 동일 URL 버스트 요청(coalescer 밖 시점)에서 origin 중복 호출 0건 확인
- 기존 통합 테스트(L1/L2 HIT, bypass, optimize)에 회귀 없음

### 16-2. Proxy 재기동 시 도메인 sync 자동화

**배경**
- 현재 `pnpm ship:proxy`로 proxy만 재배포하면 admin-server는 재기동되지 않아 도메인맵 sync를 다시 보내지 않음
- 결과: proxy의 `domain_map` 공란 → TLS SNI handshake "access denied" → 서비스 중단
- 이번 Phase 15 핫픽스에서 admin-server 수동 재기동으로 우회했으나 정식 해결 필요

**채택 방향**
- **A. proxy 기동 시 pull** (권장) — proxy `main.rs` 기동 루틴에서 admin-server에 `GET /api/domains/internal/snapshot` 호출해 도메인맵 초기 수신
  - admin-server에 신규 read-only 엔드포인트 추가
  - TLS/DNS는 각각 기존 gRPC `SyncDomains` 호출로 초기화 — 같은 snapshot 재사용
  - 장점: push 실패 시 proxy가 스스로 복구 가능
- **B. admin-server가 proxy 헬스 변화 감지 후 push** — healthMonitor의 online 전환 시점에 `syncToProxy` 자동 재호출
  - 장점: 기존 sync 경로 유지, 신규 엔드포인트 없음
  - 단점: 헬스 체크 주기(5s) 내 sync 누락 창 존재

**검증**
- proxy만 재기동 시 1차 HTTPS 요청이 TLS access denied 없이 성공
- admin-server를 건드리지 않고 ship:proxy 실행 후 도메인맵 count 로그 확인

### 16-3. 도메인 상세 페이지 탭 · 내용 배치 개선

**배경**
- Phase 10 도메인 관리 재설계 후 도메인 상세 페이지는 3탭 구조. 운영 중 "어디 탭에 뭐가 있는지 헷갈림" · "같은 지표가 여러 탭에 분산" 등 불만 축적.
- Phase 15 배포로 신규 관찰 지표(`text_compress` 이벤트, 로그탭 size 필드)도 추가되어 재배치 재검토 필요.

**채택 방향**
- 현행 탭 구성(캐시 / 최적화 / 로그) 사용자 피드백 수집
- 재배치안 2~3개 브레인스토밍 → 디자인 승인 → 구현
- 신규 카드/섹션 검토: Phase 15 텍스트 압축 절감 카드, 응답 바이트 분포 히스토그램, 에러율 추이
- 기존 카드 재배치: 이미지 최적화 통계 · 도메인 stats · 로그 탭 컬럼 레이아웃

**검증**
- Playwright E2E 전 시나리오 통과
- 키보드/스크린리더 접근성 회귀 없음
- 대시보드 Bundle 크기 증가 5% 이하

### 16-4. 범위 / 비범위
- 범위: 16-1, 16-2, 16-3만 — 이번 페이즈 한 단위 작업으로 묶음
- 비범위: 이미지 chunk 캐싱(Phase 17), 텍스트 압축 프로파일 API(Phase 18), access_logs 영속화(Phase 19)

---

## Phase 17 (후보): 미디어 Chunk/Slice 캐싱

> 목표: 대용량 미디어 및 HLS/DASH 세그먼트까지 수용하기 위해 캐시 단위를 full body에서 고정 크기 chunk로 전환한다.

현재 미디어 Range 지원은 origin에서 full body를 받아 저장하고 응답 시 슬라이싱하는 **full-body caching** 방식이다. 교과서 mp4 규모(수십 MB) · 순차 재생 패턴에서는 구현 단순성·HIT 효율 관점의 ROI가 높아 우선 채택했다.

다만 아래 조건 중 하나라도 충족되면 chunk(slice) 기반으로 전환이 필요하다.

### 17-1. 전환 조건

- 단일 미디어 크기가 수백 MB 이상으로 성장 (VOD 풀HD 장편 등)
- HLS/DASH 세그먼트 스트리밍 도입
- 첫 바이트 지연이 체감 이슈로 보고됨
- 사용자 스크럽/점프 패턴으로 뒷부분 재생률이 낮다는 실측
- 캐시 용량 대비 "미처 캐시 못 한 전체 파일" 비율이 과도하게 높아짐

판단 근거는 관찰 인프라(`optimization_events` 테이블 + `/api/optimization/stats` API)로 수집한다.

### 17-2. chunk 정책 + 스토리지 스키마

- 고정 크기 chunk (기본 1 MB, nginx `proxy_cache_slice` 방식 참조)
- 캐시 키 확장: `(url, chunk_idx)` 복합 키 / chunk 메타 테이블(보유 범위·TTL 추적)
- storage-service gRPC 인터페이스에 `get_chunk`, `put_chunk`, `list_chunks` 추가
- 기존 full-body 엔트리와의 마이그레이션 / 공존 정책

### 17-3. 요청 경로 변경

- proxy: 요청 Range → 필요한 chunk 목록 계산
- 누락 chunk만 origin에서 Range fetch (병렬 + 동시 요청 중복 방지)
- chunk 간 merge 및 hole 처리 로직
- 단일 응답으로 206 스트리밍 (전체를 메모리에 올리지 않도록 스트림 기반)
- Range 파서(`services/proxy/src/range.rs`)를 재사용하되 chunk 경계 계산기 추가

### 17-4. 관찰 인프라 확장

- `optimization_events.decision` 확장: `chunk_hit` · `chunk_partial_hit` · `chunk_miss` · `chunk_fetch_ok` · `chunk_fetch_fail`
- admin API: `/api/optimization/chunks/:url` — chunk 점유 분포 조회
- admin-web: 특정 URL의 chunk 보유 맵 시각화

### 17-5. 검증

- 순차 재생 시나리오에서 full-body 대비 HIT 비율 유지 (≥ 95%)
- 스크럽/점프 시나리오에서 불필요한 origin 왕복 감소 측정
- 첫 바이트 지연(TTFB) 개선 수치 확보
- 다중 동시 요청 중복 fetch 없음 확인

---

## Phase 18 (후보): 텍스트 압축 프로파일 관리 API / UI

> 목표: Phase 15에서 환경변수로 고정한 텍스트 압축 파라미터를 런타임 조정 가능한 프로파일로 승격. Phase 14와 동일하게 "먼저 배포 → 관찰 → 필요 시 UI 추가" 패턴을 따른다.

### 18-1. 승격 조건
- Phase 15 배포 후 `optimization_events`(`event_type = 'text_compress'`) 실측으로 아래 중 하나 이상 확인
  - content-type별 압축 이득 편차가 커서 개별 레벨 차등이 필요
  - 특정 호스트/경로 대상만 on/off 하고 싶은 운영 요구
  - size-guard 임계값(원본×0.9, 최소 1024 bytes)을 현장에서 조정할 필요

### 18-2. 범위
- `GET /api/compressor/profile` / `PUT /api/compressor/profile` — enabled, min_bytes, br_level, gzip_level, size_guard_ratio, content_type 화이트리스트
- admin-server → proxy HTTP 설정 브로드캐스트 (이미지 프로파일과 동일 경로 재사용)
- admin-web에 텍스트 압축 설정 섹션 추가 (이미지 프로파일 페이지 옆)

### 18-3. 비목표
- content-type별 레벨 차등은 18-1의 실측이 근거를 제공했을 때만 도입 (측정 전 도입 금지 — YAGNI)

---

## Phase 19 (후보): 액세스 로그 · DNS 쿼리 영속화 파이프라인

> 목표: 현재 proxy/dns-service의 in-memory 링버퍼에만 존재하는 **개별** HTTP 요청 로그와 DNS 쿼리 로그를 admin-server SQLite로 영속화. 재시작 시 휘발 + 용량 제한(proxy 100건, dns 512건) 문제 해소. Phase 13 `optimization_events` 패턴을 복제한다.

### 19-1. 현황과 승격 조건
- 현재: 도메인 상세 로그탭이 proxy `/requests` 링버퍼(100건)에 위임 — **Task 17 Quick Fix** 상태
- 승격 조건 중 하나 이상 충족 시 정식 착수
  - 운영자가 "어제/지난주" 요청/쿼리 조회 요구를 반복적으로 보고
  - proxy 재시작 직후 "로그 비어있음" 이슈 반복
  - 감사/컴플라이언스 요건(요청별 추적)이 생김
  - DNS NXDOMAIN 추세 조사에 분 집계 대신 원본 쿼리 히스토리 필요

### 19-2. 범위
- `access_logs` 테이블 + `dns_query_logs` 테이블 추가 (admin-server SQLite)
- proxy: 기존 `events.rs` 배치 push 패턴 재사용 — `/internal/requests/batch` 엔드포인트로 HTTP 배치 전송
- dns-service: 동일 패턴으로 배치 push (현재 1분 폴링 집계 외 추가)
- admin-server: 수신 → SQLite 영속화, 인덱스는 `(host, timestamp)` `(timestamp)` 기본
- 유지 정책: 기본 **7일 보관 + 주기 vacuum** — config 환경변수로 조정 가능
- admin-web: 기존 로그 탭 그대로 SQL 소스로 전환

### 19-3. 비목표
- 전문(Full-text) 검색 — 단순 LIKE 충분
- 분산 로그 수집 (ELK/Loki) — 단일 노드 전제
- body·헤더 원문 저장 — 용량·프라이버시 리스크로 영구 제외

### 19-4. 관찰·롤백
- 영속화 전후 proxy 응답 지연(p99) 비교 — 배치 push가 응답 경로에 영향 주지 않아야 함(기존 events.rs 패턴 유지)
- 쓰기 부하로 SQLite가 락이 길어지는지 7일 후 재검토
