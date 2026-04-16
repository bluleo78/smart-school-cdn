/// 캐시 기능 E2E 테스트 — 대시보드 캐시 카드 검증
/// 캐시 관리 페이지 제거로 대시보드 카드 테스트만 유지
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createPopularContent } from '../factories/cache.factory';
import { createProxyStatusOnline } from '../factories/proxy.factory';

// ─── 공통 헬퍼 ───────────────────────────────────────────────────
/** 대시보드 공통 API 모킹 */
async function mockDashboardApis(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
}

// ─── 대시보드 캐시 카드 ────────────────────────────────────────
test.describe('대시보드 — 캐시 히트율 카드', () => {
  test('히트율 퍼센트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-card')).toBeVisible();
    await expect(page.getByText('73.2%')).toBeVisible();
  });

  test('HIT/MISS 카운트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // HIT 750, MISS 274
    await expect(page.getByText('HIT 750')).toBeVisible();
    await expect(page.getByText('MISS 274')).toBeVisible();
  });

  test('로딩 중 스켈레톤이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats(), { delay: 1000 });
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-loading')).toBeVisible();
    await expect(page.getByText('73.2%')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('대시보드 — 스토리지 사용량 카드', () => {
  test('사용량 수치와 프로그레스 바가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByTestId('storage-usage-card')).toBeVisible();
    await expect(page.getByTestId('storage-bar')).toBeVisible();
    // 4_509_715_456 bytes = 4.2 GB — storage-usage-card 안에서 확인
    await expect(page.getByTestId('storage-usage-card').getByText('4.2 GB', { exact: false })).toBeVisible();
  });

  test('사용률 퍼센트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // 4509715456 / 21474836480 * 100 ≈ 21.0%
    await expect(page.getByText('21.0%', { exact: false })).toBeVisible();
  });
});

test.describe('대시보드 — 대역폭 절감 카드', () => {
  test('"대역폭 절감" 제목이 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByText('대역폭 절감')).toBeVisible();
  });

  test('절감량이 사람이 읽기 좋은 단위로 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // by_domain size_bytes = 3_000_000_000 → 2.8 GB
    await expect(page.getByText('2.8 GB')).toBeVisible();
  });
});

test.describe('대시보드 — 캐시 항목 수 카드', () => {
  test('항목 수가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // entry_count: 3842 → "3,842" — 기존 EntryCountCard에서 확인
    const entryCard = page.getByText('저장된 URL').locator('..');
    await expect(entryCard).toBeVisible();
    await expect(entryCard.getByText('3,842')).toBeVisible();
  });
});
