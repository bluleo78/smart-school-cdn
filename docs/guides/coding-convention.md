# 코딩 컨벤션

## 1. 주석 규칙

해당 프로그래밍 언어에 익숙하지 않은 사람도 로직 흐름을 파악할 수 있도록 주석을 남긴다.

### 원칙
- **파일/모듈 상단**: 이 파일이 무엇을 하는지 한 줄 설명
- **함수/메서드**: 무엇을 하고, 왜 필요한지
- **분기/조건문**: 왜 이 조건을 체크하는지
- **복잡한 로직**: 단계별로 무엇을 하는지
- **한국어로 작성**: 클래스·메서드·주요 로직에 무엇을·왜 설명

### Rust 예시
```rust
/// 원본 서버에 요청을 전달하고 응답을 반환하는 리버스 프록시 핸들러
/// Host 헤더에서 도메인을 추출하여 설정된 원본 서버로 요청을 중계한다.
async fn proxy_handler(req: Request) -> Response {
    // 1. Host 헤더에서 대상 도메인 추출
    let host = extract_host(&req);

    // 2. 설정에서 해당 도메인의 원본 서버 주소 조회
    // → 미등록 도메인이면 404 반환
    let origin = match config.get_origin(&host) {
        Some(origin) => origin,
        None => return not_found_response(),
    };

    // 3. 원본 서버에 동일한 요청 전달
    let response = client.forward_request(origin, req).await;

    // 4. 캐시 상태 헤더 추가 (아직 캐시 미구현이므로 항상 BYPASS)
    response.with_header("X-Cache-Status", "BYPASS")
}
```

### TypeScript 예시
```typescript
/** 프록시 관리 API에서 상태 정보를 조회하여 반환하는 라우트
 *  Proxy 서버가 내려가 있으면 offline 상태로 응답한다. */
app.get('/api/proxy/status', async () => {
  try {
    // Proxy 관리 API(8081)에서 상태 조회
    const res = await axios.get('http://localhost:8081/status');
    return res.data;
  } catch {
    // Proxy 서버 연결 실패 → 오프라인 상태 반환
    return { online: false, uptime: 0, requestCount: 0 };
  }
});
```

### React 예시
```tsx
/** 프록시 온라인/오프라인 상태를 보여주는 카드 컴포넌트
 *  5초 간격으로 API를 폴링하여 상태를 갱신한다. */
export function ProxyStatusCard() {
  // 5초 간격으로 프록시 상태 조회
  const { data } = useProxyStatus();

  // 온라인 여부에 따라 배지 색상 결정
  const isOnline = data?.online ?? false;
  // ...
}
```

---

## 2. 테스트 규칙

### 서버 유닛 테스트 (Vitest)
- **프레임워크**: Vitest (`vitest run`)
- **파일 위치**: 소스 파일과 같은 디렉터리에 `*.test.ts`
- **모킹**: `vi.fn()`, `vi.mock()` 으로 외부 의존성 격리
- **에러 경로**: 성공 케이스뿐 아니라 실패 케이스도 반드시 테스트
- **검증**: mock 호출 인자 + 반환값 모두 확인

```typescript
describe('Proxy 라우트', () => {
  it('프록시 온라인 시 상태 정보를 반환한다', async () => {
    // mock 설정 → API 호출 → 응답 검증
  });

  it('프록시 연결 실패 시 오프라인 상태를 반환한다', async () => {
    // mock에서 에러 발생 → fallback 응답 검증
  });
});
```

### Rust 유닛 테스트
- **위치**: 소스 파일 하단 `#[cfg(test)] mod tests`
- **통합 테스트**: `tests/` 디렉터리
- **비동기 테스트**: `#[tokio::test]`

### Playwright E2E 테스트
- **프레임워크**: Playwright (`playwright test`)
- **API 모킹**: `page.route()` 로 백엔드 없이 프론트엔드 독립 테스트
- **팩토리 함수**: 테스트 데이터 생성 (`e2e/factories/`)
- **픽스처**: API 모킹 헬퍼 (`e2e/fixtures/`)
- **검증 수준**: URL 패턴, 요소 가시성, API 페이로드, 다이얼로그 상태, 폼 입력 전부 검증

```typescript
test('프록시 온라인 시 상태 카드에 초록 배지가 표시된다', async ({ page }) => {
  // API 모킹
  await page.route('/api/proxy/status', (route) =>
    route.fulfill({ json: { online: true, uptime: 3600, requestCount: 42 } })
  );

  await page.goto('/');

  // 상태 카드 검증
  await expect(page.getByText('온라인')).toBeVisible();
  await expect(page.getByText('1시간 0분')).toBeVisible();
  await expect(page.getByText('42')).toBeVisible();
});
```

### 테스트 디렉터리 구조
```
e2e/
├── factories/       # 테스트 데이터 생성 팩토리
├── fixtures/        # API 모킹 헬퍼, 인증 픽스처
├── pages/           # 개별 페이지 테스트 (5-10 tests/page)
└── flows/           # 멀티 페이지 워크플로우 (2-4 tests/flow)
```

---

## 3. 파일 구조 규칙

### Rust
- `src/main.rs` — 엔트리포인트
- `src/config.rs` — 설정 구조체
- `src/state.rs` — 공유 상태
- `src/handlers/` — 요청 핸들러

### Node.js (Admin Server)
- `src/index.ts` — Fastify 엔트리
- `src/routes/` — REST 엔드포인트 (도메인별 분리)

### React (Admin Web)
- `src/api/` — API 클라이언트 (axios)
- `src/hooks/` — TanStack Query 훅
- `src/components/` — 재사용 컴포넌트
- `src/pages/` — 라우트 페이지
