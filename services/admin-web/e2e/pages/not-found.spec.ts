/// 404 페이지 E2E 테스트
/// 존재하지 않는 경로 접근 시 404 메시지가 표시되는지 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';
import { createCacheStats } from '../factories/cache.factory';

test('존재하지 않는 경로는 404 메시지를 표시한다', async ({ page }) => {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());

  await page.goto('/nonexistent-path');

  await expect(page.getByText('404')).toBeVisible();
  await expect(page.getByText('페이지를 찾을 수 없습니다.')).toBeVisible();
});
