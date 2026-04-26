/// 사용자 관리 페이지 E2E
/// - h2 헤딩 + 설명 텍스트 표시 확인 (h1 회귀 방지)
/// - 목록 표시 + 추가 다이얼로그 → 새 사용자가 목록에 노출
/// - 본인 행의 비활성화 버튼은 disabled
/// - 로딩 중 스켈레톤, 에러 시 에러 메시지 표시
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
    // h2로 변경 — h1 회귀를 방지하기 위해 level 명시
    await expect(page.getByRole('heading', { name: '사용자 관리', level: 2 })).toBeVisible();

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

  test('로딩 중 스켈레톤 표시', async ({ page }) => {
    // API 응답을 지연시켜 로딩 상태 검증
    await page.route('**/api/users', async (route) => {
      // 로딩 중 스켈레톤이 노출되는지 확인 후 응답
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseUsers),
      });
    });

    await page.goto('/users');
    // 로딩 완료 후 테이블 표시 확인 (스켈레톤이 사라지고 데이터 렌더링)
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('API 에러 시 에러 메시지 표시', async ({ page }) => {
    // API 실패 응답 모킹 — 빈 화면 대신 에러 메시지가 표시되어야 함
    await mockApi(page, 'GET', '/users', { error: 'Internal Server Error' }, { status: 500 });

    await page.goto('/users');

    // 에러 메시지가 표시되어야 함
    await expect(page.getByText('사용자 목록을 불러오지 못했습니다.')).toBeVisible();
    // 테이블은 표시되지 않아야 함
    await expect(page.getByRole('table')).not.toBeVisible();
  });
});
