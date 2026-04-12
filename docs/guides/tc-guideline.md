# 테스트 케이스 작성 가이드라인

> 기능 구현 시 반드시 따라야 할 TC 작성 기준과 커버리지 측정 방법.  
> **원칙: 코드를 작성하면 TC를 함께 작성한다. TC 없는 기능 병합은 허용하지 않는다.**

---

## 목차

1. [TC 분류 체계](#1-tc-분류-체계)
2. [커버리지 목표](#2-커버리지-목표)
3. [커버리지 측정 방법](#3-커버리지-측정-방법)
4. [레이어별 TC 작성 기준](#4-레이어별-tc-작성-기준)
5. [모듈별 TC 체크리스트](#5-모듈별-tc-체크리스트)
6. [신규 기능 추가 시 체크리스트](#6-신규-기능-추가-시-체크리스트)
7. [TC 품질 기준](#7-tc-품질-기준)

---

## 1. TC 분류 체계

```
단위 테스트 (Unit)
  └── 함수/메서드 단위 — 외부 의존성 없음, 빠름
통합 테스트 (Integration)
  └── 서비스 간 연동 — 실제 DB/HTTP 사용
E2E 테스트 (End-to-End)
  └── 사용자 시나리오 — 브라우저 + API 모킹
```

| 레이어 | 도구 | 위치 | 실행 명령 |
|--------|------|------|-----------|
| Rust 단위 | `cargo test --lib` | `src/` 내 `#[cfg(test)]` | `cd services/proxy && cargo test --lib` |
| Rust 통합 | `cargo test --test` | `tests/` | `cd services/proxy && cargo test --tests` |
| Admin API | Vitest | `services/admin-server/src/**/*.test.ts` | `cd services/admin-server && pnpm test` |
| Dashboard E2E | Playwright | `services/admin-web/e2e/` | `cd services/admin-web && pnpm test:e2e` |

---

## 2. 커버리지 목표

| 모듈 | 단위 | 통합 | E2E | 목표 라인 커버리지 |
|------|------|------|-----|-------------------|
| `services/proxy` (Rust) | ✅ 필수 | ✅ 필수 | — | **≥ 80%** |
| `services/storage-service` (Rust) | ✅ 필수 | 선택 | — | **≥ 70%** |
| `services/tls-service` (Rust) | ✅ 필수 | 선택 | — | **≥ 70%** |
| `services/dns-service` (Rust) | ✅ 필수 | 선택 | — | **≥ 70%** |
| `services/admin-server` | ✅ 필수 | 선택 | — | **≥ 70%** |
| `services/admin-web` | — | — | ✅ 필수 | **주요 플로우 100%** |

### E2E 커버리지 기준 (Dashboard / Page 단위)

각 페이지/기능에 대해 다음 4가지를 모두 검증해야 한다:

| 항목 | 설명 |
|------|------|
| **정상 렌더링** | 데이터가 있을 때 컴포넌트가 올바른 값을 표시하는가 |
| **빈 상태** | 데이터가 없을 때 안내 메시지가 표시되는가 |
| **로딩 상태** | API 응답 전 스켈레톤/인디케이터가 표시되는가 |
| **에러 상태** | API가 실패할 때 에러 피드백이 표시되는가 |
| **사용자 플로우** | 입력 → 이벤트 → 상태 변화 → 결과가 연결되어 있는가 |
| **입력 검증** | 잘못된/빈 입력 시 버튼 비활성화 등 방어 로직이 동작하는가 |

---

## 3. 커버리지 측정 방법

### Rust — cargo-llvm-cov 설치 및 실행

```bash
# 1회 설치
cargo install cargo-llvm-cov
rustup component add llvm-tools-preview

# 커버리지 측정 (HTML 리포트)
cd services/proxy
cargo llvm-cov --html --open

# 커버리지 측정 (터미널 요약)
cargo llvm-cov --summary-only
```

> 리포트 위치: `services/proxy/target/llvm-cov/html/index.html`

### Admin Server — Vitest coverage 설정

`@vitest/coverage-v8` 패키지 추가:

```bash
cd services/admin-server
pnpm add -D @vitest/coverage-v8
```

`vitest.config.ts`에 coverage 설정 추가:

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
```

```bash
# 커버리지 포함 실행
cd services/admin-server && pnpm test --coverage
```

> 리포트 위치: `services/admin-server/coverage/index.html`

### Admin Web E2E — 플로우 커버리지 체크리스트

Playwright는 라인 커버리지를 측정하지 않는다. 대신 **기능 커버리지**를 체크리스트로 관리한다.

각 기능 구현 후 아래 표를 `e2e/pages/[feature].spec.ts` 상단 주석에 유지:

```typescript
/// [기능명] E2E 테스트
/// 커버리지:
///   정상 렌더링  ✅
///   빈 상태      ✅
///   로딩 상태    ✅
///   에러 상태    ✅
///   사용자 플로우 ✅
///   입력 검증    ✅
```

---

## 4. 레이어별 TC 작성 기준

### Rust — 단위 테스트

**대상:** 순수 함수, 데이터 변환, 캐시 로직, 파싱

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // 패턴: [조건]_[동작]_[기대결과]
    #[test]
    fn no_store_헤더가_있으면_NoStore를_반환한다() { ... }

    #[tokio::test]
    async fn put_후_get은_동일_바이트를_반환한다() { ... }
}
```

**필수 케이스:**
- 정상 입력 → 정상 출력
- 경계값 (0, 최대값, 빈 문자열)
- 오류 입력 → 오류 반환 (panic이 아닌 Result/Option)
- 상태 변화 (카운터 증가, 큐 오버플로우)

### Rust — 통합 테스트

**대상:** HTTP 프록시 동작, 캐시 미들웨어, Admin API

```rust
// tests/cache_integration.rs
async fn start_test_proxy(response_headers: Vec<(&str, &str)>) -> TestHandles { ... }

#[tokio::test]
async fn get_요청은_miss_후_hit를_반환한다() { ... }
```

**필수 케이스:**
- 정상 프록시 흐름 (MISS → HIT)
- 캐시 제외 케이스 (no-store, non-GET)
- 원본 서버 오류 (502 반환)
- 관리 API 응답 형식 검증

### Admin Server — Vitest

**대상:** 라우트 핸들러, 비즈니스 로직, DB 쿼리

```typescript
// 패턴: axios-mock-adapter 또는 실제 Fastify inject 사용
describe('GET /api/cache/stats', () => {
  it('프록시 응답을 그대로 전달한다', async () => { ... });
  it('프록시 연결 실패 시 fallback 데이터를 반환한다', async () => { ... });
  it('프록시 500 에러 시 502를 반환한다', async () => { ... });
});
```

**필수 케이스:**
- 정상 응답 (2xx) — 데이터 포맷 검증
- 의존 서비스 실패 — fallback 또는 에러 코드 검증
- 잘못된 요청 파라미터 (400 검증)

### Admin Web — Playwright E2E

**대상:** 페이지 렌더링, 사용자 인터랙션, API 연동

```typescript
// 각 describe 블록이 하나의 "기능 영역"을 담당
test.describe('캐시 관리 페이지 — URL 퍼지', () => {
  test('정상 플로우', ...);     // 입력 → 확인 → 완료
  test('입력 검증', ...);       // 빈 입력 → 버튼 비활성화
  test('취소 플로우', ...);     // 확인 다이얼로그 취소
  test('에러 플로우', ...);     // API 500 → 에러 Toast
});
```

**필수 케이스 (모든 인터랙티브 기능에 적용):**

| 케이스 | 설명 |
|--------|------|
| 정상 플로우 | 전체 인터랙션 체인이 완료되는가 |
| 입력 검증 | 비어있는/잘못된 입력 시 방어 동작 |
| 취소/뒤로가기 | 중간에 취소 시 상태가 원복되는가 |
| 에러 응답 | API 500/400 시 사용자에게 피드백이 있는가 |
| 빈 상태 | 데이터 없을 때 안내 메시지 |
| 로딩 상태 | 응답 지연 시 로딩 인디케이터 |
| 데이터 포맷 | 숫자/날짜/바이트가 올바른 형식으로 표시되는가 |

---

## 5. 모듈별 TC 체크리스트

### services/proxy (Rust)

| 모듈 | 단위 TC 필수 항목 | 통합 TC 필수 항목 |
|------|------------------|------------------|
| `cache.rs` | compute_cache_key 결정론적 출력, parse_cache_control 모든 지시어, TTL 만료, LRU 퇴거, purge 타입별 | — |
| `state.rs` | record_request 카운터, 로그 순환(100건 초과), HIT/MISS/BYPASS 카운터, 히트율 스냅샷 | — |
| `lib.rs` (프록시) | — | MISS→HIT 캐시 흐름, no-store BYPASS, 원본 502, Admin API(stats/popular/purge) |
| `config.rs` | get_origin 도메인 매핑, 미등록 도메인 None | — |

### services/storage-service (Rust)

| 모듈 | 단위 TC 필수 항목 |
|------|------------------|
| `grpc.rs` | get miss, put 후 get hit, purge_url, purge_all, stats 총용량, popular limit, health |

### services/tls-service (Rust)

| 모듈 | 단위 TC 필수 항목 |
|------|------------------|
| `grpc.rs` | get_or_issue_cert 신규 발급, get_ca_cert, list_certificates, sync_domains, health |

### services/dns-service (Rust)

| 모듈 | 단위 TC 필수 항목 |
|------|------------------|
| `grpc.rs` | sync_domains 맵 갱신, sync 전체 교체, 빈 목록 처리, health |

### services/admin-server

| 라우트 | 필수 TC |
|--------|---------|
| `GET /api/proxy/status` | 정상 반환, 프록시 오프라인 fallback |
| `GET /api/proxy/requests` | 목록 반환, 빈 목록 |
| `GET /api/cache/stats` | 정상 반환, 프록시 실패 502 |
| `GET /api/cache/popular` | 정상 반환 |
| `DELETE /api/cache/purge` | url/domain/all 타입별, target 누락 400 |
| 도메인 CRUD | 생성/조회/삭제 정상, 중복 409, 미존재 404 |

### services/admin-web (E2E)

| 페이지/컴포넌트 | 정상 | 빈상태 | 로딩 | 에러 | 플로우 | 입력검증 |
|----------------|------|--------|------|------|--------|---------|
| DashboardPage — ProxyStatusCard | ✅ | — | ✅ | — | — | — |
| DashboardPage — CacheHitRateCard | ✅ | — | ✅ | — | — | — |
| DashboardPage — StorageUsageCard | ✅ | — | — | — | — | — |
| DashboardPage — BandwidthSavedCard | ✅ | — | — | — | — | — |
| DashboardPage — EntryCountCard | ✅ | — | — | — | — | — |
| DashboardPage — CacheHitRateChart | ✅ | — | — | — | — | — |
| DashboardPage — RequestLogTable | ✅ | ✅ | — | — | — | — |
| CachePage — URL 퍼지 | ✅ | — | — | ✅ | ✅ | ✅ |
| CachePage — 도메인 퍼지 | ✅ | — | — | — | ✅ | ✅ |
| CachePage — 전체 퍼지 | ✅ | — | — | — | ✅ | — |
| CachePage — 인기 콘텐츠 테이블 | ✅ | ✅ | — | — | — | — |
| DomainsPage | 미구현 | 미구현 | 미구현 | 미구현 | 미구현 | 미구현 |
| SystemPage — 서비스 상태 그리드 | ✅ | — | — | — | — | — |
| SystemPage — 오프라인 배너 | ✅ | — | — | — | — | — |
| SystemPage — 서버 업타임 | ✅ | — | ✅ | ✅ | — | — |
| SystemPage — 캐시 디스크 사용량 | ✅ | — | ✅ | ✅ | — | — |
| SystemPage — CA 인증서 | ✅ | — | — | — | ✅ | — |
| SystemPage — 발급된 인증서 목록 | ✅ | ✅ | ✅ | ✅ | — | — |

> **미구현** 셀은 해당 기능 구현 시 TC를 함께 추가한다.

---

## 6. 신규 기능 추가 시 체크리스트

기능 구현 PR 생성 전 아래를 모두 충족해야 한다.

### Rust 기능 추가 시

```
[ ] 새 함수/메서드마다 #[test] 블록 존재
[ ] 정상 케이스 + 경계값 + 오류 케이스 모두 포함
[ ] cargo test --lib 전체 통과
[ ] 통합 테스트가 필요한 경우 tests/ 파일 추가
[ ] cargo test 전체 통과
[ ] (선택) cargo llvm-cov --summary-only 로 커버리지 확인
```

### Admin Server API 추가 시

```
[ ] 라우트 핸들러에 대한 Vitest 테스트 파일 존재
[ ] 정상 응답 + 에러 케이스(400/404/502) 모두 포함
[ ] pnpm test 전체 통과
[ ] (선택) pnpm test --coverage 로 커버리지 확인
```

### Dashboard 기능 추가 시

```
[ ] e2e/factories/ 에 테스트 데이터 팩토리 함수 추가
[ ] e2e/pages/[feature].spec.ts 파일 생성 또는 기존 파일에 describe 블록 추가
[ ] 아래 케이스 중 해당 항목 모두 포함:
    [ ] 정상 렌더링 — 데이터 값 검증
    [ ] 빈 상태 메시지
    [ ] 로딩 스켈레톤 (data-testid="*-loading" 필요)
    [ ] 에러 Toast/메시지 (API 500 mock)
    [ ] 사용자 플로우 (인터랙션이 있는 경우)
    [ ] 입력 검증 (폼/입력란이 있는 경우)
[ ] pnpm test:e2e 전체 통과
[ ] spec 파일 상단 커버리지 주석 업데이트
```

---

## 7. TC 품질 기준

### 이름 규칙

```
[조건]_[동작]_[기대결과]           // Rust
'[조건]일 때 [기대결과]'           // TypeScript/Playwright
```

**나쁜 예:**
```
test('works')
fn test_cache()
```

**좋은 예:**
```
test('URL 입력이 비어있으면 퍼지 버튼이 비활성화된다')
fn ttl_만료_항목은_none을_반환한다()
```

### 금지 패턴

| 금지 | 이유 |
|------|------|
| 요소 존재 여부만 검증 (`toBeVisible`) | 값/내용 검증 없이는 비즈니스 로직을 보장하지 못함 |
| `page.waitForTimeout(n)` | 타이밍 기반 대기는 불안정 — `toBeVisible({ timeout })` 사용 |
| `unwrap()`/`expect()` panic 유발 | Rust 테스트에서 Result 타입은 `?` 또는 `.unwrap_or_else` |
| 테스트끼리 상태 공유 | 각 테스트는 독립적이어야 한다 |
| 프로덕션 서버에 의존 | 모든 외부 의존성은 모킹 |

### data-testid 규칙

인터랙티브 요소와 상태 표시 요소에는 `data-testid`를 부여한다:

```
[컴포넌트명]-card         // 카드 컨테이너
[컴포넌트명]-loading      // 로딩 스켈레톤
[액션명]-btn              // 버튼
[액션명]-input            // 입력란
[결과명]-toast            // 토스트/알림
confirm-[액션명]-btn      // 확인 다이얼로그 버튼
```
