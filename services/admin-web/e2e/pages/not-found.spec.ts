/// 404 페이지 E2E 테스트
/// 존재하지 않는 경로 접근 시 404 메시지와 대시보드 복귀 CTA가 표시되는지 검증한다.
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

test('404 페이지 — 대시보드로 돌아가기 링크를 클릭하면 홈(/)으로 이동한다', async ({ page }) => {
  // 대시보드 API mock: 링크 클릭 후 이동하는 페이지에서 필요
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());

  await page.goto('/nonexistent-path');

  // CTA 버튼이 보이는지 확인
  const backLink = page.getByRole('link', { name: '대시보드로 돌아가기' });
  await expect(backLink).toBeVisible();

  // 클릭 후 홈 경로로 이동하는지 확인 (입력→처리→출력 파이프라인 검증)
  await backLink.click();
  await expect(page).toHaveURL('/');
});
