/// 대시보드 캐시 카드 E2E 테스트
/// 캐시 통계 카드, 인기 콘텐츠 테이블, 전체 캐시 퍼지 기능을 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createPopularContent } from '../factories/cache.factory';

/** 대시보드 페이지에 필요한 공통 API 목을 설정한다 */
async function setupDashboardMocks(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', '/proxy/status', { status: 'online', uptime: 3600, total_requests: 42 });
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
}

test.describe('대시보드 — 캐시 통계 카드', () => {
  test('캐시 통계 카드가 항목 수와 사용량을 표시한다', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    // 캐시 통계 카드 제목 확인
    await expect(page.getByText('캐시 통계')).toBeVisible();

    // 항목 수: entry_count 3842 → "3,842건"
    await expect(page.getByText('3,842건')).toBeVisible();
  });

  test('인기 콘텐츠 Top 5 테이블이 렌더링된다', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    // 카드 제목 확인
    await expect(page.getByText('인기 콘텐츠 Top 5')).toBeVisible();

    // 팩토리 데이터의 도메인 확인
    await expect(page.getByText('cdn.textbook.com').first()).toBeVisible();

    // 경로 확인
    await expect(page.getByText('/images/cover.png')).toBeVisible();
    await expect(page.getByText('/assets/chapter1.pdf')).toBeVisible();

    // 히트 수 확인
    await expect(page.getByText('412')).toBeVisible();
    await expect(page.getByText('387')).toBeVisible();
  });

  test('전체 캐시 퍼지 버튼 → 확인 다이얼로그 → 닫힘', async ({ page }) => {
    await setupDashboardMocks(page);
    // 퍼지 API 모킹
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 100, freed_bytes: 1048576 });

    await page.goto('/');

    // 전체 캐시 퍼지 버튼 클릭
    await page.getByRole('button', { name: '전체 캐시 퍼지' }).click();

    // 확인 다이얼로그가 표시되는지 확인
    await expect(page.getByText('전체 캐시 퍼지').nth(1)).toBeVisible();

    // "퍼지 실행" 버튼 클릭
    await page.getByRole('button', { name: '퍼지 실행' }).click();

    // 다이얼로그가 닫히는지 확인
    await expect(page.getByRole('button', { name: '퍼지 실행' })).not.toBeVisible();
  });
});
