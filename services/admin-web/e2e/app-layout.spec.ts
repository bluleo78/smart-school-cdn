import { test, expect } from './fixtures/test';

test.describe('AppLayout', () => {
  test('사이드바와 대시보드 페이지가 렌더링된다', async ({ page }) => {
    await page.goto('/');

    // 사이드바 타이틀
    await expect(page.getByText('Smart School CDN')).toBeVisible();

    // 사이드바 네비게이션 항목
    await expect(page.getByRole('link', { name: '대시보드' })).toBeVisible();
    await expect(page.getByRole('link', { name: '도메인 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: '캐시 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: '최적화' })).toBeVisible();
    await expect(page.getByRole('link', { name: '시스템' })).toBeVisible();

    // 대시보드 페이지 콘텐츠
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  });

  test('사이드바 네비게이션으로 페이지 이동이 동작한다', async ({ page }) => {
    await page.goto('/');

    // 도메인 관리 페이지로 이동
    await page.getByRole('link', { name: '도메인 관리' }).click();
    await expect(page.getByRole('heading', { name: '도메인 관리' })).toBeVisible();

    // 캐시 관리 페이지로 이동
    await page.getByRole('link', { name: '캐시 관리' }).click();
    await expect(page.getByRole('heading', { name: '캐시 관리' })).toBeVisible();

    // 최적화 페이지로 이동
    await page.getByRole('link', { name: '최적화' }).click();
    await expect(page.getByRole('heading', { name: '최적화' })).toBeVisible();

    // 시스템 페이지로 이동
    await page.getByRole('link', { name: '시스템' }).click();
    await expect(page.getByRole('heading', { name: '시스템' })).toBeVisible();

    // 대시보드로 복귀
    await page.getByRole('link', { name: '대시보드' }).click();
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  });
});
