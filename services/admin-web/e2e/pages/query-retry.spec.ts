/// QueryClient retry 정책 회귀 테스트 (#308)
/// - 4xx (404/400/401/403) 응답에는 retry 하지 않는다
/// - 5xx 응답에는 1회 retry 한다
///
/// 입력: 모킹된 admin-server 응답
/// 처리: TanStack Query 전역 retry 함수 (services/admin-web/src/main.tsx)
/// 출력: 동일 GET 요청 횟수 (4xx 1회 / 5xx 2회)
import { test, expect } from '../fixtures/test';

/// /domains/:host 라우트는 마운트 시 GET /api/domains/:host 호출
/// (DomainDetailPage 의 useQuery). retry 동작 검증에 적합한 단일 호출 페이지.
const TARGET_HOST = 'retry-test.example.com';
const TARGET_PATH = `**/api/domains/${TARGET_HOST}`;

test.describe('QueryClient retry 정책 (#308)', () => {
  test('4xx(404) 응답에는 retry 하지 않는다 — 요청 1회', async ({ page }) => {
    let count = 0;
    await page.route(TARGET_PATH, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      count += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_found' }),
      });
    });

    await page.goto(`/domains/${TARGET_HOST}`);
    // retry 가 발생할 수 있는 시간(기본 backoff ~1초) 충분히 대기
    await page.waitForTimeout(2500);

    // 4xx 는 첫 시도 후 즉시 실패 처리되어야 한다
    expect(count).toBe(1);
  });

  test('5xx(500) 응답에는 1회 retry — 요청 2회', async ({ page }) => {
    let count = 0;
    await page.route(TARGET_PATH, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      count += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal' }),
      });
    });

    await page.goto(`/domains/${TARGET_HOST}`);
    // retry backoff(react-query 기본 ~1초) 이후 재시도 완료까지 대기
    await page.waitForTimeout(2500);

    // 5xx 는 first-try + retry 1회 = 총 2회
    expect(count).toBe(2);
  });
});
