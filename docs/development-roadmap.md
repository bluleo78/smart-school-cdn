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
- [ ] hickory-dns 기반 DNS 서버 (포트 53)
- [ ] 미등록 도메인 → upstream DNS 포워딩
- [ ] 등록 도메인 → CDN 서버 IP 반환 + 와일드카드 지원

### 5-2. Admin API — 도메인 관리
- [ ] `POST /api/domains` — 도메인 추가 → DNS 오버라이드 + 인증서 발급
- [ ] `GET /api/domains` — 목록 (DNS 상태, 인증서 상태 포함)
- [ ] `DELETE /api/domains/:id` — 삭제 → DNS 해제 + 인증서 제거
- [ ] `GET /api/domains/:id` — 상세 (캐시 통계, 인증서 정보)

### 5-3. Dashboard — 도메인 관리 페이지
- [ ] 도메인 목록 테이블 (도메인명, DNS 상태, 인증서 상태, 캐시 사용량)
- [ ] 도메인 추가 다이얼로그 (React Hook Form + Zod v4 검증)
- [ ] 도메인 삭제 확인 다이얼로그
- [ ] 도메인 상세 페이지 (캐시 통계 탭, 인증서 정보 탭)

### 검증 (전체 E2E)
> 대시보드에서 `cdn.textbook.com` 도메인 추가 → 목록에 "활성" 배지 표시
> `dig @<CDN-IP> cdn.textbook.com` → CDN IP 응답
> `dig @<CDN-IP> auth.textbook.com` → 원본 IP 응답 (바이패스)
> 태블릿 DNS를 CDN으로 설정 → 교과서 앱에서 콘텐츠 로딩 → 대시보드에 HIT/MISS 통계 반영
> 도메인 상세 페이지에서 캐시 히트율, 트래픽 확인
> 도메인 삭제 → DNS 오버라이드 해제 → `dig` 원본 IP 응답

---

## Phase 6: 서비스 분리 + 서비스 헬스체크 UI

> 목표: 모놀리식 → 마이크로서비스 리팩터링. 기능 변화 없음.
> Dashboard에서 각 서비스 상태를 개별 모니터링.

### 6-1. Storage Service 분리
- [ ] `proto/storage.proto` (Get, Put, Delete, Purge, Stats)
- [ ] Proxy 내부 캐시 → Storage Service (tonic gRPC)로 추출
- [ ] Proxy → Storage gRPC 통신

### 6-2. TLS Service 분리
- [ ] `proto/tls.proto` (CreateCA, IssueCert, GetCert, GetCACert)
- [ ] Proxy 내부 인증서 → TLS Service로 추출

### 6-3. DNS Service 분리
- [ ] `proto/dns.proto` (AddDomain, RemoveDomain, ListDomains)
- [ ] DNS → 독립 서비스, 도메인 목록 gRPC 동적 관리

### 6-4. Docker Compose
- [ ] `docker-compose.yml` 서비스 구성 + gRPC 네트워크

### 6-5. Admin API — 서비스 헬스체크
- [ ] `GET /api/system/status` — 각 서비스(Proxy, Storage, DNS, TLS) 개별 상태
- [ ] Admin Server → 각 서비스 gRPC 헬스체크 호출

### 6-6. Dashboard — 시스템 페이지 (v3)
- [ ] 서비스별 상태 카드 (Proxy, Storage, DNS, TLS — 각각 온라인/오프라인 배지)
- [ ] 서비스 응답시간 표시
- [ ] 서비스 장애 시 알림 배너

### 검증
> **Phase 5의 전체 E2E가 동일하게 통과** (기능 변화 없음)
> 대시보드 시스템 페이지 → 4개 서비스 모두 "온라인" 배지
> Storage 서비스 중지 → 해당 카드 "오프라인" 전환 + 알림 배너 표시
> Storage 재시작 → "온라인" 복구
> `docker compose ps` → 모든 서비스 Running

---

## Phase 7: 콘텐츠 최적화 + 최적화 설정 UI

> 목표: 이미지 최적화 통합, Dashboard에서 최적화 프로파일 관리 + 절감 효과 확인

### 7-1. Optimizer Service
- [ ] `proto/optimizer.proto` (Optimize, GetProfiles, SetProfile)
- [ ] PNG/JPEG → WebP 변환 + 리사이즈 + 품질 조정
- [ ] Proxy가 캐시 MISS 시 Optimizer 경유 후 저장
- [ ] 이미 최적화된 포맷(WebP, AVIF) 바이패스
- [ ] 텍스트 압축 (gzip/brotli)

### 7-2. Admin API — 최적화 관리
- [ ] `GET /api/optimizer/profiles` — 프로파일 목록
- [ ] `PUT /api/optimizer/profiles/:id` — 프로파일 수정 (품질, 해상도, 포맷)
- [ ] `GET /api/stats/optimization` — 최적화 절감 통계 (원본 크기 vs 최적화 크기)

### 7-3. Dashboard — 최적화 페이지 + 대시보드 (v3)
- [ ] 최적화 프로파일 편집 폼 (품질 슬라이더, 최대 해상도, 포맷 선택)
- [ ] 최적화 절감 통계 카드 (원본 총 용량 vs 최적화 후 용량, 절감률)
- [ ] 대시보드에 최적화 절감 카드 추가

### 검증
> 최적화 페이지에서 프로파일 "tablet" 설정 (WebP, 80%, max 2048px)
> 프록시를 통해 2MB PNG 요청 → 대시보드에서 최적화 절감 표시 (원본 2MB → 최적화 ~300KB)
> 최적화 페이지에서 품질 60%로 변경 → 재요청 → 용량 추가 감소 확인
> 이미 WebP인 이미지 → 변환 없이 통과 (절감 0%)

---

## Phase 8: 고급 기능

> 목표: 운영 품질 향상 기능

### 8-1. 동시 요청 병합 (Request Coalescing)
- [ ] 같은 URL 동시 요청 시 원본에 1회만 요청
- **검증**: 부하 테스트 도구로 동일 URL 동시 50개 → 원본 서버 로그 1회, 대시보드 트래픽 50건 표시

### 8-2. 메모리 캐시 레이어
- [ ] 핫 콘텐츠 메모리 캐시 (디스크 위 2단 캐시)
- **검증**: 대시보드에서 메모리/디스크 캐시 비율 표시, 인기 콘텐츠가 메모리 캐시로 승격됨을 확인

### 8-3. 로그 뷰어
- [ ] Dashboard 시스템 페이지에 실시간 로그 뷰어 추가
- **검증**: 대시보드에서 각 서비스 로그를 실시간 스트리밍으로 확인

---

## Phase 9: E2E 테스트 자동화

> 목표: 전체 시스템 자동화 검증

### 9-1. Playwright E2E 테스트
- [ ] 도메인 추가 → 캐시 생성 → 퍼지 → 통계 확인 시나리오
- [ ] 인증서 다운로드 시나리오
- [ ] 최적화 프로파일 변경 시나리오
- **검증**: `pnpm test:e2e` → 모든 시나리오 통과

### 9-2. 인프라 통합 테스트
- [ ] Docker Compose 전체 기동 → DNS → HTTPS → 캐시 → Dashboard 반영
- **검증**: CI에서 자동화 스크립트 실행 → 전체 파이프라인 통과

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
| 6 | 서비스 분리 | 마이크로서비스 | 서비스별 헬스체크 카드 |
| 7 | + 최적화 | 이미지 WebP | 프로파일 편집 + 절감 통계 |
| 8 | + 고급 기능 | 요청 병합, 로그 | 메모리 캐시 비율 + 로그 뷰어 |
| 9 | E2E 테스트 | 자동화 검증 | Playwright 전 시나리오 통과 |
