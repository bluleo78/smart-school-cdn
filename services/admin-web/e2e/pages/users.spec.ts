/// 사용자 관리 페이지 E2E
/// - 목록 표시 + 추가 다이얼로그 → 새 사용자가 목록에 노출
/// - 본인 행의 비활성화 버튼은 disabled
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { TEST_USER } from '../fixtures/auth-mock';

/** 기본 사용자 목록 — 본인(TEST_USER) + 다른 활성 사용자 1명 */
const baseUsers = [
  {
    id: TEST_USER.id,
    username: TEST_USER.username,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    disabled_at: null,
    last_login_at: TEST_USER.last_login_at,
  },
  {
    id: 2,
    username: 'other@example.com',
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
    disabled_at: null,
    last_login_at: null,
  },
];

test.describe('사용자 관리', () => {
  test('목록 표시 + 추가', async ({ page }) => {
    // 초기 목록은 본인 + 1명. 추가 후 invalidateQueries 로 재조회되면 신규 사용자 포함.
    let added: { id: number; username: string } | null = null;
    await page.route('**/api/users', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const list = added
          ? [
              ...baseUsers,
              {
                id: added.id,
                username: added.username,
                created_at: '2026-04-25T00:00:00.000Z',
                updated_at: '2026-04-25T00:00:00.000Z',
                disabled_at: null,
                last_login_at: null,
              },
            ]
          : baseUsers;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(list),
        });
        return;
      }
      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as { username: string };
        added = { id: 999, username: body.username };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 999,
            username: body.username,
            created_at: '2026-04-25T00:00:00.000Z',
            updated_at: '2026-04-25T00:00:00.000Z',
            disabled_at: null,
            last_login_at: null,
          }),
        });
        return;
      }
      return route.fallback();
    });

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();

    // 추가 버튼 클릭 → 다이얼로그
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    const newEmail = 'new-user@test.local';
    await page.fill('input[type=email]', newEmail);
    await page.fill('input[type=password]', 'password-1234');

    // 다이얼로그 내부 "추가" 버튼 클릭 (헤더의 "+ 사용자 추가" 와 구분)
    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 새 사용자 행이 목록에 노출되어야 함
    await expect(page.getByText(newEmail)).toBeVisible();
  });

  test('자기 자신 비활성화 버튼 disabled', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // TEST_USER 행의 비활성화 버튼은 disabled
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await expect(myRow.getByRole('button', { name: '비활성화' })).toBeDisabled();

    // 다른 사용자 행의 비활성화 버튼은 활성
    const otherRow = page.getByTestId('user-row-2');
    await expect(otherRow.getByRole('button', { name: '비활성화' })).toBeEnabled();
  });
});
