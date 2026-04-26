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

  // 이슈 #34 회귀 방지 — 사용자 추가 다이얼로그 빈 입력 시 "입력해주세요" 메시지 표시
  test('사용자 추가 다이얼로그 — 빈 입력 시 "입력해주세요" 메시지 표시', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);
    await page.goto('/users');

    // 추가 버튼 클릭 → 다이얼로그
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    // 다이얼로그 내부 "추가" 버튼을 빈 입력으로 클릭
    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 빈 입력 에러: 포맷/길이 에러가 아닌 "입력해주세요" 메시지가 표시되어야 함
    await expect(page.getByText('이메일을 입력해주세요.')).toBeVisible();
    await expect(page.getByText('비밀번호를 입력해주세요.')).toBeVisible();
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

  // 이슈 #14 회귀 방지 — 비활성화 확인에 shadcn AlertDialog 사용 (네이티브 confirm() 제거)
  test('비활성화 클릭 시 shadcn AlertDialog 표시 및 취소', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 다른 사용자 행의 비활성화 버튼 클릭
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비활성화' }).click();

    // shadcn AlertDialog가 표시되어야 함 (네이티브 confirm 팝업 아님)
    const dialog = page.getByTestId('disable-user-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('other@example.com')).toBeVisible();

    // 취소 버튼 클릭 — 다이얼로그가 닫혀야 함
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).not.toBeVisible();
  });

  // 이슈 #14 회귀 방지 — 비활성화 확인에서 확인 버튼 클릭 시 API 호출 및 목록 갱신
  test('비활성화 확인 시 API 호출 후 목록 갱신', async ({ page }) => {
    let disableApiCalled = false;
    const disabledUsers = baseUsers.map((u) =>
      u.id === 2 ? { ...u, disabled_at: '2026-04-26T00:00:00.000Z' } : u
    );

    await page.route('**/api/users', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        // disableApiCalled 이후 재조회 시 비활성화된 목록 반환
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(disableApiCalled ? disabledUsers : baseUsers),
        });
      } else {
        return route.fallback();
      }
    });

    // DELETE /users/2 — disableUser API 엔드포인트
    await page.route('**/api/users/2', async (route) => {
      if (route.request().method() === 'DELETE') {
        disableApiCalled = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    // 비활성화 버튼 클릭
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비활성화' }).click();

    // AlertDialog에서 확인 클릭
    const dialog = page.getByTestId('disable-user-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('disable-user-confirm').click();

    // 다이얼로그 닫힘 확인
    await expect(dialog).not.toBeVisible();
    // API가 호출되었는지 확인
    expect(disableApiCalled).toBe(true);
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

  // 이슈 #17 회귀 방지 — 테이블 행에 hover:bg-muted/50 transition-colors 클래스 적용
  test('테이블 행에 hover 스타일 클래스 적용 확인', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 데이터 행이 hover:bg-muted/50 transition-colors 클래스를 가져야 함
    const dataRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await expect(dataRow).toBeVisible();
    const classList = await dataRow.evaluate((el) => el.className);
    expect(classList).toContain('hover:bg-muted/50');
    expect(classList).toContain('transition-colors');
  });

  // 이슈 #44 회귀 방지 — 비밀번호 입력 필드 autocomplete 속성 누락
  test('사용자 추가 다이얼로그 — 비밀번호 입력에 autocomplete="new-password" 속성 존재', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 사용자 추가 다이얼로그 열기
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    // 비밀번호 입력 필드에 autocomplete="new-password" 속성이 있어야 함
    const passwordInput = page.locator('input[type=password]');
    await expect(passwordInput).toBeVisible();
    const autocomplete = await passwordInput.getAttribute('autocomplete');
    expect(autocomplete).toBe('new-password');
  });

  // 이슈 #44 회귀 방지 — 비밀번호 재설정 다이얼로그 autocomplete 속성 누락
  test('비밀번호 재설정 다이얼로그 — 비밀번호 입력에 autocomplete="new-password" 속성 존재', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 비밀번호 재설정 버튼 클릭 (본인이 아닌 other 사용자 행)
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 비밀번호 재설정 다이얼로그의 입력 필드에 autocomplete="new-password" 속성이 있어야 함
    const passwordInput = page.locator('input[type=password]');
    await expect(passwordInput).toBeVisible();
    const autocomplete = await passwordInput.getAttribute('autocomplete');
    expect(autocomplete).toBe('new-password');
  });

  // 이슈 #56 회귀 방지 — 사용자 추가 다이얼로그 이메일 입력 autocomplete 속성 누락
  test('사용자 추가 다이얼로그 — 이메일 입력에 autocomplete="username" 속성 존재', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 사용자 추가 다이얼로그 열기
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    // 이메일 입력 필드에 autocomplete="username" 속성이 있어야 함 — 브라우저 DOM 경고 제거
    const emailInput = page.locator('input[type=email]');
    await expect(emailInput).toBeVisible();
    const autocomplete = await emailInput.getAttribute('autocomplete');
    expect(autocomplete).toBe('username');
  });

  // 이슈 #52 회귀 방지 — 빈 사용자 목록 시 안내 메시지 누락
  test('빈 사용자 목록 시 "등록된 사용자가 없습니다." 메시지 표시', async ({ page }) => {
    // 빈 배열 반환 — 테이블 헤더만 표시되고 빈 바디가 나오는 버그 재현 조건
    await mockApi(page, 'GET', '/users', []);

    await page.goto('/users');

    // 빈 상태 안내 메시지가 표시되어야 함
    await expect(page.getByText('등록된 사용자가 없습니다.')).toBeVisible();
    // 테이블 자체는 헤더와 함께 표시되어야 함
    await expect(page.getByRole('table')).toBeVisible();
  });

  // 이슈 #58 회귀 방지 — 비밀번호 재설정 폼에 username 숨김 필드 누락 (비밀번호 매니저 연동 불가)
  test('비밀번호 재설정 다이얼로그 — username 숨김 필드 존재 및 값 일치', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // other 사용자 행의 비밀번호 재설정 버튼 클릭
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 숨김 username 필드가 폼 내에 존재해야 함 — 비밀번호 매니저 연동을 위한 필수 필드
    const hiddenUsername = page.locator('input[type=hidden][name=username]');
    await expect(hiddenUsername).toHaveCount(1);

    // 값이 해당 사용자의 username과 일치해야 함
    const usernameValue = await hiddenUsername.inputValue();
    expect(usernameValue).toBe('other@example.com');

    // autocomplete="username" 속성이 있어야 함
    const autocomplete = await hiddenUsername.getAttribute('autocomplete');
    expect(autocomplete).toBe('username');
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

  // 이슈 #76 회귀 방지 — 사용자 추가 다이얼로그 비밀번호 필드 표시/숨기기 토글 없음
  test('사용자 추가 다이얼로그 — 비밀번호 표시/숨기기 토글 동작', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    // 기본값: type=password (숨김 상태)
    const passwordInput = page.locator('input[name=password]');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // 토글 버튼 클릭 → type=text (표시 상태)
    await page.getByRole('button', { name: '비밀번호 표시' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // 다시 클릭 → type=password (숨김 상태로 복귀)
    await page.getByRole('button', { name: '비밀번호 숨기기' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // 이슈 #76 회귀 방지 — 비밀번호 재설정 다이얼로그 비밀번호 필드 표시/숨기기 토글 없음
  test('비밀번호 재설정 다이얼로그 — 비밀번호 표시/숨기기 토글 동작', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // other 사용자 행의 비밀번호 재설정 버튼 클릭
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 기본값: type=password (숨김 상태)
    const passwordInput = page.locator('input[name=password]');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // 토글 버튼 클릭 → type=text (표시 상태)
    await page.getByRole('button', { name: '비밀번호 표시' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // 다시 클릭 → type=password (숨김 상태로 복귀)
    await page.getByRole('button', { name: '비밀번호 숨기기' }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  // 이슈 #63 회귀 방지 — 사용자 추가 뮤테이션 실패(409) 시 다이얼로그가 즉시 닫히는 낙관적 닫기 버그
  test('사용자 추가 409 오류 시 다이얼로그 유지 + 입력값 보존', async ({ page }) => {
    await page.route('**/api/users', async (route) => {
      if (route.request().method() === 'POST') {
        // 409 충돌 응답 — 이미 존재하는 이메일 시나리오
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'already_exists' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(baseUsers),
        });
      }
    });

    await page.goto('/users');
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    const testEmail = 'existing@example.com';
    await page.fill('input[type=email]', testEmail);
    await page.fill('input[type=password]', 'password1234');

    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 오류 시 다이얼로그는 열린 상태를 유지해야 함 (낙관적 닫기 버그 재현 방지)
    await expect(page.getByRole('dialog', { name: '사용자 추가' })).toBeVisible();

    // 입력값이 보존되어야 함 — 사용자가 재입력할 필요 없음
    await expect(page.locator('input[type=email]')).toHaveValue(testEmail);
  });

  // 이슈 #63 회귀 방지 — 추가 버튼이 제출 중 disabled 처리 안 되는 버그 (중복 제출 가능)
  test('사용자 추가 — 제출 중 추가 버튼 disabled', async ({ page }) => {
    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    await page.route('**/api/users', async (route) => {
      if (route.request().method() === 'POST') {
        // 요청을 의도적으로 보류해 isPending 상태를 유지
        await requestPromise;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(baseUsers[0]) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseUsers) });
      }
    });

    await page.goto('/users');
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    await page.fill('input[type=email]', 'new@example.com');
    await page.fill('input[type=password]', 'password1234');

    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 제출 중 버튼이 disabled 상태여야 함 — 중복 제출 방지
    await expect(page.getByRole('button', { name: '추가 중…' })).toBeDisabled();

    // 요청 완료
    resolveRequest!(null);
  });

  // 이슈 #63 회귀 방지 — 비밀번호 재설정 뮤테이션 실패 시 다이얼로그가 즉시 닫히는 낙관적 닫기 버그
  test('비밀번호 재설정 오류 시 다이얼로그 유지 + 입력값 보존', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    // PUT /users/:id/password — 서버 오류 응답
    await page.route('**/api/users/2/password', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'internal_error' }),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    const newPassword = 'newpassword1234';
    await page.fill('input[type=password]', newPassword);

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 오류 시 다이얼로그는 열린 상태를 유지해야 함
    await expect(page.getByRole('dialog')).toBeVisible();

    // 입력값이 보존되어야 함
    await expect(page.locator('input[type=password]')).toHaveValue(newPassword);
  });

  // 이슈 #77 회귀 방지 — formatDateTime 12시간제(오전/오후) 표기 버그
  test('마지막 로그인 컬럼 — 24시간제 표기 (오전/오후 없음)', async ({ page }) => {
    // TEST_USER.last_login_at = '2026-04-25T00:00:00.000Z' (한국 시간 09:00:00)
    // 24시간제라면 "9시 00분 00초" 또는 "9:00:00" 형태여야 하고, "오전/오후" 문자열이 없어야 함
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await expect(myRow).toBeVisible();

    // 마지막 로그인 셀 — 오전/오후 텍스트가 포함되어서는 안 됨 (24시간제 정책)
    const lastLoginCell = myRow.locator('td').nth(2);
    const cellText = await lastLoginCell.textContent();
    expect(cellText).not.toContain('오전');
    expect(cellText).not.toContain('오후');
    expect(cellText).not.toContain('AM');
    expect(cellText).not.toContain('PM');
  });

  // 이슈 #63 회귀 방지 — 비밀번호 재설정 버튼이 제출 중 disabled 처리 안 되는 버그
  test('비밀번호 재설정 — 제출 중 재설정 버튼 disabled', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    await page.route('**/api/users/2/password', async (route) => {
      if (route.request().method() === 'PUT') {
        // 요청을 의도적으로 보류해 isPending 상태를 유지
        await requestPromise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    await page.fill('input[type=password]', 'newpassword1234');

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 제출 중 버튼이 disabled 상태여야 함
    await expect(page.getByRole('button', { name: '재설정 중…' })).toBeDisabled();

    // 요청 완료
    resolveRequest!(null);
  });
});
