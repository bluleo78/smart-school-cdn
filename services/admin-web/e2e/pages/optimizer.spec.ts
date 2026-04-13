/// 최적화 설정 페이지 E2E 테스트
/// 프로파일 테이블, 편집 Dialog, 절감 통계 카드를 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProfileList, createStatsList } from '../factories/optimizer.factory';
import { createProxyStatusOnline } from '../factories/proxy.factory';

/** 공통 API 모킹 설정 */
async function setupMocks(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/optimizer/profiles', { profiles: createProfileList() });
  await mockApi(page, 'GET', '/stats/optimization', { stats: createStatsList() });
}

test.describe('최적화 페이지 — 기본 렌더링', () => {
  test('페이지 제목 "최적화"가 표시된다', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    await expect(page.getByRole('heading', { name: '최적화' })).toBeVisible();
  });

  test('프로파일 테이블에 두 도메인이 표시된다', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    await expect(page.getByTestId('profiles-table')).toBeVisible();
    await expect(page.getByText('textbook.co.kr')).toBeVisible();
    await expect(page.getByText('static.edunet.net')).toBeVisible();
  });

  test('활성화 배지가 올바르게 표시된다', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    // textbook.co.kr 행: 활성 배지
    const rows = page.getByTestId('profiles-table').locator('tbody tr');
    await expect(rows.nth(0).getByTestId('profile-enabled-badge')).toContainText('활성');
    // static.edunet.net 행: 비활성 배지
    await expect(rows.nth(1).getByTestId('profile-enabled-badge')).toContainText('비활성');
  });
});

test.describe('최적화 페이지 — 편집 Dialog', () => {
  test('편집 버튼 클릭 시 Dialog가 열리고 품질 값이 표시된다', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    // 첫 번째 행(textbook.co.kr) 편집 버튼 클릭
    const rows = page.getByTestId('profiles-table').locator('tbody tr');
    await rows.nth(0).getByTestId('profile-edit-btn').click();

    await expect(page.getByTestId('profile-edit-dialog')).toBeVisible();
    // 품질 값 85가 max-width 입력에 반영되었는지 확인 (Label에 표시됨)
    await expect(page.getByTestId('profile-edit-dialog')).toContainText('85');
  });

  test('편집 저장 후 Dialog가 닫힌다', async ({ page }) => {
    await setupMocks(page);
    // PUT 모킹: 204 No Content
    await mockApi(page, 'PUT', '/optimizer/profiles/textbook.co.kr', null, { status: 204 });
    await page.goto('/optimizer');

    const rows = page.getByTestId('profiles-table').locator('tbody tr');
    await rows.nth(0).getByTestId('profile-edit-btn').click();
    await expect(page.getByTestId('profile-edit-dialog')).toBeVisible();

    await page.getByTestId('profile-save-btn').click();

    await expect(page.getByTestId('profile-edit-dialog')).not.toBeVisible();
  });
});
