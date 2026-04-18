/// 캐시 기능 E2E 테스트 — 대시보드 캐시 카드 검증 (재설계 후 shape)
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createCacheSeriesBuckets, createPopularContent } from '../factories/cache.factory';
import { createProxyStatusOnline } from '../factories/proxy.factory';

// ─── 공통 헬퍼 ───────────────────────────────────────────────────
/** 대시보드 공통 API 모킹 */
async function mockDashboardApis(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
  await page.route('**/api/cache/series*', (route) =>
    route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
  );
}

// ─── 대시보드 L1 히트율 카드 ──────────────────────────────────
test.describe('대시보드 — L1 히트율 카드', () => {
  test('L1 히트율 퍼센트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-card')).toBeVisible();
    // createCacheStats() → l1_hit_rate = 700/1000 = 0.7 → "70.0%"
    await expect(page.getByTestId('dashboard-l1-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-l1-hit-rate')).toHaveText('70.0%');
  });

  test('L1 HIT/요청 카운트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // l1_hits 700, requests 1000 — 카드 하단 부제목에 표시 (cache-hit-rate-card 내부)
    const card = page.getByTestId('cache-hit-rate-card');
    await expect(card.getByText(/L1 HIT 700/)).toBeVisible();
    await expect(card.getByText(/요청 1,000/)).toBeVisible();
  });

  test('로딩 중 스켈레톤이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats(), { delay: 1000 });
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-loading')).toBeVisible();
    await expect(page.getByTestId('dashboard-l1-hit-rate')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 엣지 히트율 카드 ─────────────────────────────────────────
test.describe('대시보드 — 엣지 히트율 카드', () => {
  test('엣지 히트율이 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // edge_hit_rate = (700+100)/1000 = 0.8 → "80.0%"
    await expect(page.getByTestId('dashboard-edge-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-edge-hit-rate')).toHaveText('80.0%');
  });
});

// ─── BYPASS 비율 카드 ─────────────────────────────────────────
test.describe('대시보드 — BYPASS 비율 카드', () => {
  test('BYPASS 비율이 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // bypass_rate = 50/1000 = 0.05 → "5.0%"
    await expect(page.getByTestId('dashboard-bypass-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-bypass-rate')).toHaveText('5.0%');
  });
});

// ─── 스토리지 사용량 카드 ─────────────────────────────────────
test.describe('대시보드 — 스토리지 사용량 카드', () => {
  test('사용량 수치와 프로그레스 바가 표시된다', async ({ page }) => {
    const stats = createCacheStats({
      disk: { used_bytes: 4_509_715_456, max_bytes: 21_474_836_480, entry_count: 42 },
    });
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', stats);
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );
    await page.goto('/');
    await expect(page.getByTestId('storage-usage-card')).toBeVisible();
    await expect(page.getByTestId('storage-bar')).toBeVisible();
    // 4_509_715_456 bytes ≈ 4.2 GB
    await expect(page.getByTestId('storage-usage-card').getByText('4.2 GB', { exact: false })).toBeVisible();
  });

  test('사용률 퍼센트가 표시된다', async ({ page }) => {
    const stats = createCacheStats({
      disk: { used_bytes: 4_509_715_456, max_bytes: 21_474_836_480, entry_count: 42 },
    });
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', stats);
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );
    await page.goto('/');
    // 4509715456 / 21474836480 * 100 ≈ 21.0%
    await expect(page.getByText('21.0%', { exact: false })).toBeVisible();
  });
});

// ─── 캐시 항목 수 카드 ────────────────────────────────────────
test.describe('대시보드 — 캐시 항목 수 카드', () => {
  test('항목 수가 표시된다', async ({ page }) => {
    const stats = createCacheStats({
      disk: { used_bytes: 1024 * 1024, max_bytes: 20 * 1024 ** 3, entry_count: 3842 },
    });
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', stats);
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );
    await page.goto('/');
    // entry_count: 3842 → "3,842"
    await expect(page.getByTestId('dashboard-entry-count')).toBeVisible();
    await expect(page.getByTestId('dashboard-entry-count')).toHaveText('3,842');
  });
});
