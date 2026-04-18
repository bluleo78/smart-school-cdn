/// 대시보드 캐시 카드 E2E 테스트 (재설계 후)
/// L1/엣지/BYPASS 카드, 스택 차트, 도메인 표, 인기 콘텐츠, 전체 퍼지를 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createCacheSeriesBuckets, createPopularContent } from '../factories/cache.factory';

/** 대시보드 페이지에 필요한 공통 API 목을 설정한다 */
async function setupDashboardMocks(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', '/proxy/status', { status: 'online', uptime: 3600, total_requests: 42 });
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
  await page.route('**/api/cache/series*', (route) =>
    route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
  );
}

// ─── L1 히트율 · 스택 차트 · 도메인 표 렌더 ─────────────────
test.describe('대시보드 — 캐시 재설계 카드 렌더링', () => {
  test('L1 히트율 카드 · 엣지 히트율 카드 · BYPASS 카드 · 스택 차트 · 도메인 표 렌더', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard-l1-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-edge-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-bypass-rate')).toBeVisible();
    await expect(page.getByTestId('cache-stacked-chart')).toBeVisible();
    await expect(page.getByTestId('by-domain-table')).toBeVisible();
  });

  test('1h/24h 토글 시 /api/cache/series?range=24h 요청', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');
    const req = page.waitForRequest(
      (r) => r.url().includes('/api/cache/series') && r.url().includes('range=24h'),
    );
    await page.getByTestId('cache-range-24h').click();
    await req;
  });
});

// ─── 인기 콘텐츠 테이블 ───────────────────────────────────────
test.describe('대시보드 — 인기 콘텐츠', () => {
  test('인기 콘텐츠 Top 5 테이블이 렌더링된다', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    await expect(page.getByText('인기 콘텐츠 Top 5')).toBeVisible();
    await expect(page.getByText('cdn.textbook.com').first()).toBeVisible();
    await expect(page.getByText('/images/cover.png')).toBeVisible();
    await expect(page.getByText('/assets/chapter1.pdf')).toBeVisible();
    await expect(page.getByText('412')).toBeVisible();
    await expect(page.getByText('387')).toBeVisible();
  });
});

// ─── 전체 캐시 퍼지 ──────────────────────────────────────────
test.describe('대시보드 — 전체 캐시 퍼지', () => {
  test('전체 캐시 퍼지 버튼 → 확인 다이얼로그 → 닫힘', async ({ page }) => {
    await setupDashboardMocks(page);
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 100, freed_bytes: 1048576 });

    await page.goto('/');

    await page.getByRole('button', { name: '전체 캐시 퍼지' }).click();
    await expect(page.getByText('전체 캐시 퍼지').nth(1)).toBeVisible();

    await page.getByRole('button', { name: '퍼지 실행' }).click();
    await expect(page.getByRole('button', { name: '퍼지 실행' })).not.toBeVisible();
  });
});
