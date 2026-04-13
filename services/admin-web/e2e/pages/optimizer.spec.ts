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
    await expect(page.getByTestId('profile-row-textbook.co.kr').getByTestId('profile-enabled-badge')).toContainText('활성');
    // static.edunet.net 행: 비활성 배지
    await expect(page.getByTestId('profile-row-static.edunet.net').getByTestId('profile-enabled-badge')).toContainText('비활성');
  });
});

test.describe('최적화 페이지 — 절감 통계 카드', () => {
  test('절감 통계 카드 렌더링', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    // savings-pct: (1 - 9_200_000/15_000_000)*100 ≈ 38.7%
    const savingsEl = page.getByTestId('savings-pct');
    await expect(savingsEl).toBeVisible();
    await expect(savingsEl).toContainText('38');
  });
});

test.describe('최적화 페이지 — 편집 Dialog', () => {
  test('편집 버튼 클릭 시 Dialog가 열리고 현재 값이 표시된다', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/optimizer');

    // textbook.co.kr 행 편집 버튼 클릭
    await page.getByTestId('profile-row-textbook.co.kr').getByTestId('profile-edit-btn').click();

    const dialog = page.getByTestId('profile-edit-dialog');
    await expect(dialog).toBeVisible();
    // 품질 값 85 — Label에 "품질 (85)"로 표시됨
    await expect(dialog).toContainText('85');
    // max_width 입력 필드 값 0
    await expect(page.getByTestId('max-width-input')).toHaveValue('0');
    // enabled Switch — textbook.co.kr은 활성화 상태
    await expect(page.getByTestId('enabled-switch')).toBeChecked();
  });

  test('편집 저장 후 PUT 요청이 전송되고 Dialog가 닫힌다', async ({ page }) => {
    await setupMocks(page);
    // PUT 모킹: 204 No Content
    await mockApi(page, 'PUT', '/optimizer/profiles/textbook.co.kr', null, { status: 204 });
    await page.goto('/optimizer');

    await page.getByTestId('profile-row-textbook.co.kr').getByTestId('profile-edit-btn').click();
    await expect(page.getByTestId('profile-edit-dialog')).toBeVisible();

    // PUT 요청 전송 확인 + Dialog 닫힘 검증
    const [putRequest] = await Promise.all([
      page.waitForRequest(req =>
        req.url().includes('/optimizer/profiles/') && req.method() === 'PUT'
      ),
      page.getByTestId('profile-save-btn').click(),
    ]);
    expect(putRequest.method()).toBe('PUT');
    await expect(page.getByTestId('profile-edit-dialog')).not.toBeVisible();
  });
});
