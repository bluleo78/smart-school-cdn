import { test, expect } from '../fixtures/test';

test.describe('시스템 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/system');
  });

  test('시스템 페이지가 렌더링된다', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '시스템' })).toBeVisible();
  });

  test('서버 업타임 섹션이 표시된다', async ({ page }) => {
    await expect(page.getByText('서버 업타임')).toBeVisible();
    await expect(page.getByTestId('uptime-value')).toBeVisible();
  });

  test('디스크 사용량 섹션이 표시된다', async ({ page }) => {
    await expect(page.getByText('캐시 디스크 사용량')).toBeVisible();
    await expect(page.getByTestId('disk-usage-bar')).toBeVisible();
  });
});
