/// 사용자 관리 페이지 E2E
/// - h2 헤딩 + 설명 텍스트 표시 확인 (h1 회귀 방지)
/// - 목록 표시 + 추가 다이얼로그 → 새 사용자가 목록에 노출
/// - 본인 행의 비활성화 버튼은 disabled
/// - 로딩 중 스켈레톤, 에러 시 에러 메시지 표시
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { TEST_USER } from '../fixtures/auth-mock';

/** 비활성 사용자가 포함된 목록 — 본인(TEST_USER) + 비활성 사용자 1명 */
const usersWithDisabled = [
  {
    id: TEST_USER.id,
    username: TEST_USER.username,
    created_at: 1775001600,
    updated_at: 1775001600,
    disabled_at: null,
    last_login_at: TEST_USER.last_login_at,
  },
  {
    id: 2,
    username: 'disabled@example.com',
    created_at: 1775779200,
    updated_at: 1777161600,
    disabled_at: 1777161600,
    last_login_at: null,
  },
];

/** 기본 사용자 목록 — 본인(TEST_USER) + 다른 활성 사용자 1명 */
const baseUsers = [
  {
    id: TEST_USER.id,
    username: TEST_USER.username,
    created_at: 1775001600,
    updated_at: 1775001600,
    disabled_at: null,
    last_login_at: TEST_USER.last_login_at,
  },
  {
    id: 2,
    username: 'other@example.com',
    created_at: 1775779200,
    updated_at: 1775779200,
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
                created_at: 1777075200,
                updated_at: 1777075200,
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
            created_at: 1777075200,
            updated_at: 1777075200,
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
    await expect(page.getByRole('heading', { name: '사용자', level: 2 })).toBeVisible();

    // 추가 버튼 클릭 → 다이얼로그
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    const newEmail = 'new-user@test.local';
    await page.fill('input[type=email]', newEmail);
    // #217 confirm 필드 도입으로 input[type=password] 다중 매치 → id 기반 단일 선택자
    await page.fill('input#add-user-password', 'password-1234');
    await page.fill('input#add-user-password-confirm', 'password-1234');

    // 다이얼로그 내부 "추가" 버튼 클릭 (헤더의 "+ 사용자 추가" 와 구분)
    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 새 사용자 행이 목록에 노출되어야 함
    await expect(page.getByText(newEmail)).toBeVisible();
  });

  // 이슈 #248 회귀 방지 — 사용자 추가 다이얼로그 필수 입력값이 비어 있으면 제출 버튼 disabled (#232 패턴).
  // 모든 필수 필드 채우면 활성화되고, 일부만 채우면 여전히 disabled 상태여야 함.
  test('사용자 추가 다이얼로그 — 빈 입력 시 "추가" 버튼 disabled', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);
    await page.goto('/users');

    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    const submit = page.getByRole('button', { name: '추가', exact: true });
    // 초기: 모든 필드 빈 상태 → disabled
    await expect(submit).toBeDisabled();

    // 이메일만 입력 → 여전히 disabled (비밀번호/확인 미입력)
    await page.fill('input#add-user-email', 'new@example.com');
    await expect(submit).toBeDisabled();

    // 비밀번호 추가 입력 → 여전히 disabled (확인 필드 미입력)
    await page.fill('input#add-user-password', 'password-1234');
    await expect(submit).toBeDisabled();

    // 확인 필드까지 입력 → 활성화
    await page.fill('input#add-user-password-confirm', 'password-1234');
    await expect(submit).toBeEnabled();
  });

  // 이슈 #248 회귀 방지 — 비밀번호 재설정 다이얼로그 필수 입력값이 비어 있으면 제출 버튼 disabled (#232 패턴).
  // 다른 사용자 비밀번호 재설정 케이스: currentPassword 필드가 노출되지 않으므로 password/confirmPassword만 검사.
  test('비밀번호 재설정 다이얼로그 — 빈 입력 시 "재설정" 버튼 disabled', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);
    await page.goto('/users');

    // 다른 사용자(id=2) 행의 "비밀번호 재설정" 클릭 — currentPassword 필드 미노출
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    const submit = page.getByRole('button', { name: '재설정', exact: true });
    // 초기: 모든 필드 빈 상태 → disabled
    await expect(submit).toBeDisabled();

    // 새 비밀번호만 입력 → 여전히 disabled (확인 필드 미입력)
    await page.fill('input#reset-password', 'new-pass-1234');
    await expect(submit).toBeDisabled();

    // 확인 필드까지 입력 → 활성화
    await page.fill('input#reset-password-confirm', 'new-pass-1234');
    await expect(submit).toBeEnabled();
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
      u.id === 2 ? { ...u, disabled_at: 1777161600 } : u
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
    // #217 confirm 필드 도입으로 input[type=password] 다중 매치 → id 기반 단일 선택자로 한정
    const passwordInput = page.locator('input#add-user-password');
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
    // #211 confirm 필드 도입으로 input[type=password]가 다중 매치 → id 기반 단일 선택자로 한정
    const passwordInput = page.locator('input#reset-password');
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

  // 이슈 #218 회귀 방지 — 비활성 사용자 행이 활성 사용자와 시각적으로 구분되어야 함
  // 행 전체 dimmed 처리(opacity-60 + bg-muted/30) + data-disabled="true" 마커로 검증
  test('비활성 사용자 행은 dimmed 처리(opacity 60%) + data-disabled 마커', async ({ page }) => {
    await mockApi(page, 'GET', '/users', usersWithDisabled);

    await page.goto('/users');

    // 활성 행 — data-disabled="false"
    const activeRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await expect(activeRow).toHaveAttribute('data-disabled', 'false');
    // opacity 무지정(=1) — 컴퓨티드 스타일로 dimmed 아님 확인
    const activeOpacity = await activeRow.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(activeOpacity)).toBeGreaterThan(0.95);

    // 비활성 행 — data-disabled="true" + opacity-60 (=0.6)
    const disabledRow = page.getByTestId('user-row-2');
    await expect(disabledRow).toHaveAttribute('data-disabled', 'true');
    const disabledOpacity = await disabledRow.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(disabledOpacity)).toBeLessThan(0.7);
  });

  // 이슈 #106 회귀 방지 — 비활성 사용자 행에 재활성화 버튼 없음
  test('비활성 사용자 행에 재활성화 버튼 표시 (비활성화 버튼 없음)', async ({ page }) => {
    await mockApi(page, 'GET', '/users', usersWithDisabled);

    await page.goto('/users');

    // 비활성 사용자 행에 재활성화 버튼이 있어야 함
    const disabledRow = page.getByTestId('user-row-2');
    await expect(disabledRow.getByRole('button', { name: '재활성화' })).toBeVisible();

    // 비활성 사용자 행에 비활성화 버튼은 없어야 함
    await expect(disabledRow.getByRole('button', { name: '비활성화' })).not.toBeVisible();
  });

  // 이슈 #106 회귀 방지 — 재활성화 클릭 시 확인 다이얼로그 + 취소
  test('재활성화 클릭 시 shadcn AlertDialog 표시 및 취소', async ({ page }) => {
    await mockApi(page, 'GET', '/users', usersWithDisabled);

    await page.goto('/users');

    // 비활성 사용자 행의 재활성화 버튼 클릭
    const disabledRow = page.getByTestId('user-row-2');
    await disabledRow.getByRole('button', { name: '재활성화' }).click();

    // shadcn AlertDialog가 표시되어야 함
    const dialog = page.getByTestId('enable-user-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('disabled@example.com')).toBeVisible();

    // 취소 버튼 클릭 — 다이얼로그가 닫혀야 함
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).not.toBeVisible();
  });

  // 이슈 #106 회귀 방지 — 재활성화 확인 시 API 호출 및 목록 갱신
  test('재활성화 확인 시 API 호출 후 목록 갱신', async ({ page }) => {
    let enableApiCalled = false;
    const enabledUsers = usersWithDisabled.map((u) =>
      u.id === 2 ? { ...u, disabled_at: null } : u
    );

    await page.route('**/api/users', async (route) => {
      if (route.request().method() === 'GET') {
        // enableApiCalled 이후 재조회 시 재활성화된 목록 반환
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(enableApiCalled ? enabledUsers : usersWithDisabled),
        });
      } else {
        return route.fallback();
      }
    });

    // PUT /users/2/enable — enableUser API 엔드포인트
    await page.route('**/api/users/2/enable', async (route) => {
      if (route.request().method() === 'PUT') {
        enableApiCalled = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    // 재활성화 버튼 클릭
    const disabledRow = page.getByTestId('user-row-2');
    await disabledRow.getByRole('button', { name: '재활성화' }).click();

    // AlertDialog에서 확인 클릭
    const dialog = page.getByTestId('enable-user-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('enable-user-confirm').click();

    // 다이얼로그 닫힘 확인
    await expect(dialog).not.toBeVisible();
    // API가 호출되었는지 확인
    expect(enableApiCalled).toBe(true);
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
    // #217 confirm 필드 도입으로 input[name=password] 다중 매치 → id 기반 단일 선택자로 한정
    const passwordInput = page.locator('input#add-user-password');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // 새 비밀번호 필드의 토글 버튼만 한정 — #217 confirm 필드 도입으로 토글이 2개 존재
    const toggleBtn = passwordInput.locator('..').getByRole('button', { name: /비밀번호 (표시|숨기기)/ });
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // 다시 클릭 → type=password (숨김 상태로 복귀)
    await toggleBtn.click();
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

    // 새 비밀번호 필드의 토글 버튼만 한정 — #211 confirm 필드 도입으로 토글이 2개 존재
    const toggleBtn = passwordInput.locator('..').getByRole('button', { name: /비밀번호 (표시|숨기기)/ });
    await toggleBtn.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // 다시 클릭 → type=password (숨김 상태로 복귀)
    await toggleBtn.click();
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
    // #217 confirm 필드 도입 — id 기반 단일 선택자로 한정 + 일치 입력
    await page.fill('input#add-user-password', 'password1234');
    await page.fill('input#add-user-password-confirm', 'password1234');

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
    // #217 confirm 필드 도입 — id 기반 단일 선택자로 한정 + 일치 입력
    await page.fill('input#add-user-password', 'password1234');
    await page.fill('input#add-user-password-confirm', 'password1234');

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
    await page.fill('input#reset-password', newPassword);
    // confirmPassword 일치 입력 — 새 확인 필드 도입(#211) 후 mutation 통과 조건
    await page.fill('input#reset-password-confirm', newPassword);

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 오류 시 다이얼로그는 열린 상태를 유지해야 함
    await expect(page.getByRole('dialog')).toBeVisible();

    // 입력값이 보존되어야 함
    await expect(page.locator('input#reset-password')).toHaveValue(newPassword);
  });

  // 이슈 #77 회귀 방지 — formatDateTime 12시간제(오전/오후) 표기 버그
  test('마지막 로그인 컬럼 — 24시간제 표기 (오전/오후 없음)', async ({ page }) => {
    // TEST_USER.last_login_at = 1777075200 (한국 시간 09:00:00)
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

  // 이슈 #31 회귀 방지 — 자기 자신 비밀번호 재설정 다이얼로그에 현재 비밀번호 필드 표시
  test('자기 자신 비밀번호 재설정 다이얼로그 — 현재 비밀번호 필드 표시', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 자기 자신(TEST_USER) 행의 비밀번호 재설정 버튼 클릭
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 현재 비밀번호 입력 필드가 표시되어야 함
    const currentPasswordInput = page.locator('input#current-password');
    await expect(currentPasswordInput).toBeVisible();
    const autocomplete = await currentPasswordInput.getAttribute('autocomplete');
    expect(autocomplete).toBe('current-password');
  });

  // 이슈 #193 회귀 방지 — 비밀번호 재설정 다이얼로그 입력 placeholder 누락
  // 빈 placeholder는 비밀번호 매니저/스크린리더 보조 라벨에서 무시되어 컨텍스트가 약함
  test('비밀번호 재설정 다이얼로그 — 현재/새 비밀번호 입력에 placeholder 존재', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 자기 자신 행: 현재 비밀번호 + 새 비밀번호 두 필드 모두 placeholder 검증
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    const currentPlaceholder = await page.locator('input#current-password').getAttribute('placeholder');
    expect(currentPlaceholder?.length ?? 0).toBeGreaterThan(0);

    const newPlaceholder = await page.locator('input#reset-password').getAttribute('placeholder');
    expect(newPlaceholder?.length ?? 0).toBeGreaterThan(0);
  });

  // 이슈 #31 회귀 방지 — 다른 사용자 비밀번호 재설정 시 현재 비밀번호 필드 미표시
  test('다른 사용자 비밀번호 재설정 다이얼로그 — 현재 비밀번호 필드 없음', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 다른 사용자(id=2) 행의 비밀번호 재설정 버튼 클릭
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 현재 비밀번호 필드가 표시되지 않아야 함 (다른 사용자는 검증 불필요)
    await expect(page.locator('input#current-password')).not.toBeVisible();
  });

  // 이슈 #31 회귀 방지 — 자기 자신 비밀번호 재설정 시 currentPassword를 API에 전달
  test('자기 자신 비밀번호 재설정 — currentPassword 포함 API 호출', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(`**/api/users/${TEST_USER.id}/password`, async (route) => {
      if (route.request().method() === 'PUT') {
        capturedBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 현재 비밀번호 + 새 비밀번호 + 새 비밀번호 확인 입력 (#211 confirm 필드 도입)
    await page.fill('input#current-password', 'currentpass1');
    await page.fill('input#reset-password', 'newpassword1234');
    await page.fill('input#reset-password-confirm', 'newpassword1234');

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // API 요청에 currentPassword가 포함되어야 함
    await expect.poll(() => capturedBody).not.toBeNull();
    expect(capturedBody!['currentPassword']).toBe('currentpass1');
    expect(capturedBody!['password']).toBe('newpassword1234');
  });

  // 이슈 #138 회귀 방지 — 비활성화 확인 버튼 isPending 로딩 상태 절대 표시 불가 (즉시 닫힘 버그)
  test('비활성화 확인 — 처리 중 버튼 텍스트 표시 및 disabled 상태', async ({ page }) => {
    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    await page.route('**/api/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(baseUsers),
      });
    });

    // DELETE /users/2 — disableUser API를 의도적으로 지연해 isPending 상태 유지
    await page.route('**/api/users/2', async (route) => {
      if (route.request().method() === 'DELETE') {
        await requestPromise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비활성화' }).click();

    const dialog = page.getByTestId('disable-user-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('disable-user-confirm').click();

    // 다이얼로그가 즉시 닫히지 않고 열린 상태 유지 — 즉시 닫힘 버그 방지
    await expect(dialog).toBeVisible();
    // 처리 중 텍스트가 표시되어야 함
    await expect(dialog.getByRole('button', { name: '처리 중…' })).toBeDisabled();

    // 요청 완료 → 다이얼로그 닫힘
    resolveRequest!(null);
    await expect(dialog).not.toBeVisible();
  });

  // 이슈 #138 회귀 방지 — 재활성화 확인 버튼 isPending 로딩 상태 절대 표시 불가 (즉시 닫힘 버그)
  test('재활성화 확인 — 처리 중 버튼 텍스트 표시 및 disabled 상태', async ({ page }) => {
    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    await page.route('**/api/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(usersWithDisabled),
      });
    });

    // PUT /users/2/enable — enableUser API를 의도적으로 지연해 isPending 상태 유지
    await page.route('**/api/users/2/enable', async (route) => {
      if (route.request().method() === 'PUT') {
        await requestPromise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');

    const disabledRow = page.getByTestId('user-row-2');
    await disabledRow.getByRole('button', { name: '재활성화' }).click();

    const dialog = page.getByTestId('enable-user-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('enable-user-confirm').click();

    // 다이얼로그가 즉시 닫히지 않고 열린 상태 유지 — 즉시 닫힘 버그 방지
    await expect(dialog).toBeVisible();
    // 처리 중 텍스트가 표시되어야 함
    await expect(dialog.getByRole('button', { name: '처리 중…' })).toBeDisabled();

    // 요청 완료 → 다이얼로그 닫힘
    resolveRequest!(null);
    await expect(dialog).not.toBeVisible();
  });

  /**
   * 이슈 #159 회귀 방지 — 자기 자신 비밀번호 변경 시 빈 currentPassword 클라이언트 검증 누락
   * 수정 전: currentPassword 빈값으로 제출 → 서버 API 호출 → 모호한 에러 토스트
   * 수정 후: isSelf + currentPassword 빈값 → 클라이언트 인라인 에러, 서버 호출 없음
   */
  test('자기 자신 비밀번호 재설정 — 현재 비밀번호 빈값 제출 시 인라인 에러 표시, API 미호출 — 회귀 방지 #159', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    // 서버 호출 여부 추적 — 클라이언트 검증이 올바르면 이 라우트는 호출되지 않아야 한다
    let passwordApiCalled = false;
    await page.route(`**/api/users/${TEST_USER.id}/password`, async (route) => {
      passwordApiCalled = true;
      return route.fallback();
    });

    await page.goto('/users');

    // 자기 자신(TEST_USER) 행의 비밀번호 재설정 버튼 클릭
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 현재 비밀번호 필드를 비운 채 새 비밀번호 + 확인만 입력 (#211 confirm 필드 통과)
    await page.fill('input#reset-password', 'newpassword1234');
    await page.fill('input#reset-password-confirm', 'newpassword1234');

    // #248 적용 후: isSelf && !currentPassword → 제출 버튼 자체가 disabled 상태
    // (이전 #159 동작인 인라인 에러 표시는 disabled 가드로 흡수됨)
    const submit = page.getByRole('button', { name: '재설정', exact: true });
    await expect(submit).toBeDisabled();

    // 서버 API가 호출되지 않아야 한다 (클라이언트 가드에서 막혀야 함)
    expect(passwordApiCalled).toBe(false);

    // currentPassword 입력 시 다시 활성화되는지도 확인 — 가드가 정확한 조건만 막음을 검증
    await page.fill('input#current-password', 'whatever');
    await expect(submit).toBeEnabled();
  });

  /**
   * 이슈 #161 회귀 방지 — 취소 후 다른 사용자 선택 시 이전 입력값 잔존
   * 수정 전: 취소 버튼 onClick에 passwordForm.reset() 누락 → 다음 오픈 시 dirty state 잔존
   * 수정 후: 취소/onClose 경로 모두에서 passwordForm.reset() 호출 → 항상 빈 상태로 시작
   */
  test('비밀번호 재설정 — 취소 후 다른 사용자 선택 시 이전 입력값 초기화 — 회귀 방지 #161', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 1. other 사용자(id=2)의 비밀번호 재설정 다이얼로그 열기
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 2. 새 비밀번호 입력
    const typedPassword = 'dirty-state-test1234';
    await page.fill('input[name=password]', typedPassword);
    await expect(page.locator('input[name=password]')).toHaveValue(typedPassword);

    // 3. 취소 버튼 클릭
    await page.getByRole('button', { name: '취소' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // 4. TEST_USER(본인) 행의 비밀번호 재설정 다이얼로그 열기
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 5. 이전에 입력한 비밀번호가 잔존하지 않아야 함
    const newPasswordInput = page.locator('input[name=password]');
    await expect(newPasswordInput).toBeVisible();
    await expect(newPasswordInput).toHaveValue('');
  });

  /**
   * 이슈 #161 회귀 방지 — 닫기 버튼(X) / Escape로 닫을 때도 폼 초기화
   * onClose 핸들러에 passwordForm.reset() 추가로 모든 닫기 경로 방어
   */
  test('비밀번호 재설정 — 닫기(X) 후 다른 사용자 선택 시 이전 입력값 초기화 — 회귀 방지 #161', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // 1. other 사용자 다이얼로그 열기
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 2. 비밀번호 입력
    const typedPassword = 'onclose-dirty-state9999';
    await page.fill('input[name=password]', typedPassword);

    // 3. Escape 키로 닫기 (onClose 경로)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // 4. TEST_USER 비밀번호 재설정 다이얼로그 열기
    const myRow = page.getByTestId(`user-row-${TEST_USER.id}`);
    await myRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 5. 이전 입력값이 잔존하지 않아야 함
    await expect(page.locator('input[name=password]')).toHaveValue('');
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

    // #211 confirm 필드 도입 후 password + confirmPassword 둘 다 채워야 mutation 진행
    await page.fill('input#reset-password', 'newpassword1234');
    await page.fill('input#reset-password-confirm', 'newpassword1234');

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 제출 중 버튼이 disabled 상태여야 함
    await expect(page.getByRole('button', { name: '재설정 중…' })).toBeDisabled();

    // 요청 완료
    resolveRequest!(null);
  });

  /**
   * 이슈 #211 회귀 방지 — 비밀번호 재설정 다이얼로그 confirm 필드 누락
   * 수정 전: '새 비밀번호' 단일 필드 → 토글 미사용 시 plaintext 미확인 오타 그대로 저장
   * 수정 후: '새 비밀번호 확인' 필드 추가, 두 입력 일치 검증 통과해야 mutation 호출
   */
  test('비밀번호 재설정 — 새 비밀번호 확인 필드 존재 — 회귀 방지 #211', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');

    // other 사용자 비밀번호 재설정 다이얼로그 열기
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 새 비밀번호 + 새 비밀번호 확인 두 필드 모두 표시되어야 함
    await expect(page.locator('input#reset-password')).toBeVisible();
    await expect(page.locator('input#reset-password-confirm')).toBeVisible();

    // 확인 필드 autocomplete="new-password" 동일 적용
    const confirmAutocomplete = await page.locator('input#reset-password-confirm').getAttribute('autocomplete');
    expect(confirmAutocomplete).toBe('new-password');
  });

  test('비밀번호 재설정 — confirm 불일치 시 인라인 에러 + API 미호출 — #211', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    // 서버 호출 여부 추적 — 클라이언트 검증이 올바르면 PUT 라우트는 호출되지 않아야 함
    let passwordApiCalled = false;
    await page.route('**/api/users/2/password', async (route) => {
      passwordApiCalled = true;
      return route.fallback();
    });

    await page.goto('/users');
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // 의도한 비밀번호와 다른 오타가 confirm 에 들어간 시나리오
    await page.fill('input#reset-password', 'Passw0rd!');
    await page.fill('input#reset-password-confirm', 'Passw)rd!');

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 인라인 에러 표시
    await expect(page.getByText('비밀번호가 일치하지 않습니다.')).toBeVisible();

    // 서버 API가 호출되지 않아야 함
    expect(passwordApiCalled).toBe(false);
  });

  test('비밀번호 재설정 — confirm 빈값 시 인라인 에러 + API 미호출 — #211', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    let passwordApiCalled = false;
    await page.route('**/api/users/2/password', async (route) => {
      passwordApiCalled = true;
      return route.fallback();
    });

    await page.goto('/users');
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    // confirm 빈값
    await page.fill('input#reset-password', 'newpassword1234');

    // #248 적용 후: confirmPassword 빈값 → 제출 버튼 자체가 disabled (이전 인라인 에러 동작 흡수)
    const submit = page.getByRole('button', { name: '재설정', exact: true });
    await expect(submit).toBeDisabled();

    // 서버 API 미호출
    expect(passwordApiCalled).toBe(false);
  });

  test('비밀번호 재설정 — confirm 일치 시 정상 mutation 호출 — #211', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/api/users/2/password', async (route) => {
      if (route.request().method() === 'PUT') {
        capturedBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');
    const otherRow = page.getByTestId('user-row-2');
    await otherRow.getByRole('button', { name: '비밀번호 재설정' }).click();

    await page.fill('input#reset-password', 'newpassword1234');
    await page.fill('input#reset-password-confirm', 'newpassword1234');

    await page.getByRole('button', { name: '재설정', exact: true }).click();

    await expect.poll(() => capturedBody).not.toBeNull();
    // confirmPassword 는 서버에 전송하지 않음 — password 만 전달
    expect(capturedBody!['password']).toBe('newpassword1234');
  });

  /**
   * 이슈 #188 회귀 방지 — 사용자 추가 Dialog mutation 진행 중 ESC/백드롭/취소 닫기 차단
   * 수정 전: createMut.isPending 가드 누락 → 진행 중 닫기 가능 → 백그라운드 mutation race
   * 수정 후: onClose 가드 + DialogContent disableClose + 취소 버튼 disabled (#165 패턴 답습)
   */
  test('사용자 추가 — 제출 중 ESC/백드롭/취소 닫기 차단 — 회귀 방지 #188', async ({ page }) => {
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
    await page.fill('input[type=email]', 'pending@example.com');
    // #217 confirm 필드 도입 — id 기반 단일 선택자로 한정 + 일치 입력
    await page.fill('input#add-user-password', 'password1234');
    await page.fill('input#add-user-password-confirm', 'password1234');
    await page.getByRole('button', { name: '추가', exact: true }).click();

    // 제출 중임을 확인
    await expect(page.getByRole('button', { name: '추가 중…' })).toBeDisabled();

    const dialog = page.getByRole('dialog', { name: '사용자 추가' });
    await expect(dialog).toBeVisible();

    // 1. ESC 닫기 차단
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    // 2. 취소 버튼 disabled
    await expect(dialog.getByRole('button', { name: '취소' })).toBeDisabled();

    // 3. 백드롭 클릭 닫기 차단 — Radix Dialog overlay 직접 클릭
    await page.locator('[data-slot="dialog-overlay"], [role=dialog]').first();
    // 백드롭은 dialog 영역 외 좌표를 클릭. dialog 외부 좌상단 (10, 10)
    await page.mouse.click(10, 10);
    await expect(dialog).toBeVisible();

    // 요청 완료 — 정상 닫기 검증
    resolveRequest!(null);
    await expect(dialog).not.toBeVisible();
  });

  /**
   * 이슈 #188 회귀 방지 — 비밀번호 재설정 Dialog mutation 진행 중 ESC/백드롭/취소 닫기 차단
   */
  test('비밀번호 재설정 — 제출 중 ESC/백드롭/취소 닫기 차단 — 회귀 방지 #188', async ({ page }) => {
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
    // #211 confirm 필드 도입 후 password + confirmPassword 둘 다 채워야 mutation 진행
    await page.fill('input#reset-password', 'newpassword1234');
    await page.fill('input#reset-password-confirm', 'newpassword1234');
    await page.getByRole('button', { name: '재설정', exact: true }).click();

    // 제출 중임을 확인
    await expect(page.getByRole('button', { name: '재설정 중…' })).toBeDisabled();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 1. ESC 닫기 차단
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    // 2. 취소 버튼 disabled
    await expect(dialog.getByRole('button', { name: '취소' })).toBeDisabled();

    // 3. 백드롭 클릭 닫기 차단
    await page.mouse.click(10, 10);
    await expect(dialog).toBeVisible();

    // 요청 완료 — 정상 닫기 검증
    resolveRequest!(null);
    await expect(dialog).not.toBeVisible();
  });

  /**
   * 이슈 #217 회귀 방지 — 사용자 추가 폼 비밀번호 재입력(confirmPassword) 필드 누락
   * 수정 전: password 단일 필드 → 토글 미사용 시 plaintext 미확인 오타가 그대로 해시 저장 → 새 계정 잠금
   * 수정 후: confirmPassword 필드 + zod refine 일치 검증 → 불일치 시 인라인 에러로 mutation 차단
   */
  test('사용자 추가 — 비밀번호 불일치 시 인라인 에러 + mutation 차단 — 회귀 방지 #217', async ({ page }) => {
    let postCalled = false;
    await page.route('**/api/users', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(baseUsers[0]) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseUsers) });
      }
    });

    await page.goto('/users');
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    // 1. 비밀번호 두 입력값을 다르게 입력
    await page.fill('input[type=email]', 'mismatch@example.com');
    await page.fill('input#add-user-password', 'password1234');
    await page.fill('input#add-user-password-confirm', 'password0000');

    // 2. 추가 버튼 클릭 → zod refine 차단 → 인라인 에러 표시
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await expect(page.getByText('비밀번호가 일치하지 않습니다.')).toBeVisible();

    // 3. mutation 호출되지 않았는지 검증 (서버 왕복 차단)
    expect(postCalled).toBe(false);

    // 4. 다이얼로그 유지 확인
    await expect(page.getByRole('dialog', { name: '사용자 추가' })).toBeVisible();

    // 5. 일치하도록 수정 후 제출 → mutation 정상 진행
    await page.fill('input#add-user-password-confirm', 'password1234');
    await page.getByRole('button', { name: '추가', exact: true }).click();
    expect(postCalled).toBe(true);
  });

  /**
   * 이슈 #217 회귀 방지 — confirmPassword 입력에 autocomplete="new-password" 속성 존재
   * 비밀번호 매니저가 자동완성 후보로 제안하지 않도록 신규 비밀번호 힌트 명시
   */
  test('사용자 추가 다이얼로그 — 비밀번호 확인 입력 autocomplete="new-password" — 회귀 방지 #217', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);

    await page.goto('/users');
    await page.getByRole('button', { name: '+ 사용자 추가' }).click();

    const confirmInput = page.locator('input#add-user-password-confirm');
    await expect(confirmInput).toBeVisible();
    expect(await confirmInput.getAttribute('autocomplete')).toBe('new-password');
  });

  /**
   * 이슈 #252 회귀 방지 — `__dup_N__` sentinel 접두사가 UI에 raw로 노출되지 않고
   * 원본 이메일 + "보존된 충돌 항목" 라벨로 표시되어야 한다.
   * 또한 보존 행의 비밀번호 재설정/재활성화 버튼이 disabled여야 한다.
   */
  test('충돌 정리 보존 행 — sentinel 접두사 제거되고 표시 + 액션 잠금 (#252)', async ({ page }) => {
    const dupUsers = [
      {
        id: TEST_USER.id,
        username: TEST_USER.username,
        created_at: 1775001600,
        updated_at: 1775001600,
        disabled_at: null,
        last_login_at: TEST_USER.last_login_at,
      },
      {
        id: 3,
        username: '__dup_3__bluleo78@gmail.com',
        created_at: 1778025600,
        updated_at: 1778025600,
        disabled_at: 1778105507,
        last_login_at: null,
      },
    ];
    await mockApi(page, 'GET', '/users', dupUsers);

    await page.goto('/users');

    // raw sentinel은 어디에도 보이지 않아야 함
    await expect(page.getByText('__dup_3__')).toHaveCount(0);

    // 표시는 원본 이메일만, 보조 라벨 동반
    const dupRow = page.locator('[data-testid="user-row-3"]');
    await expect(dupRow).toBeVisible();
    await expect(dupRow).toHaveAttribute('data-archived-duplicate', 'true');
    await expect(dupRow.getByText('bluleo78@gmail.com', { exact: true })).toBeVisible();
    await expect(dupRow.locator('[data-testid="archived-duplicate-badge"]')).toBeVisible();

    // 보존 행의 비밀번호 재설정/재활성화 버튼은 잠겨 있어야 함
    await expect(dupRow.getByRole('button', { name: '비밀번호 재설정' })).toBeDisabled();
    await expect(dupRow.getByRole('button', { name: '재활성화' })).toBeDisabled();
  });

  /**
   * 이슈 #279 회귀 방지 — iPad 세로(810×1080) viewport에서 사용자 테이블이 컨테이너를 넘지 않고
   * 액션 컬럼의 비활성화/재활성화 버튼이 viewport 안에 보여야 한다.
   * 수정: lg(1024px) 미만에서 "마지막 로그인" 컬럼을 숨겨 폭을 확보.
   */
  test('iPad 세로 — 액션 컬럼 비활성화 버튼 가시성 + 마지막 로그인 컬럼 숨김 (#279)', async ({ page }) => {
    await page.setViewportSize({ width: 810, height: 1080 });
    await mockApi(page, 'GET', '/users', usersWithDisabled);

    await page.goto('/users');

    // 마지막 로그인 헤더는 lg 미만에서 숨겨져야 함
    await expect(page.getByRole('columnheader', { name: '마지막 로그인' })).toBeHidden();

    // 비활성 사용자 행의 재활성화 버튼이 viewport 내에 위치해야 함 (가로 overflow 없이 노출)
    const disabledRow = page.locator('[data-testid="user-row-2"]');
    const enableBtn = disabledRow.getByRole('button', { name: '재활성화' });
    await expect(enableBtn).toBeVisible();
    const box = await enableBtn.boundingBox();
    expect(box).not.toBeNull();
    // 우측 가장자리가 viewport(810) 안에 들어와야 함
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(810);

    // 테이블 컨테이너가 가로 overflow를 일으키지 않아야 함
    const overflow = await page.evaluate(() => {
      const t = document.querySelector('table');
      const p = t?.parentElement;
      return { tableW: t?.clientWidth ?? 0, parentW: p?.clientWidth ?? 0, scrollW: p?.scrollWidth ?? 0 };
    });
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.parentW);
  });

  /**
   * 이슈 #332 회귀 방지 — 다중 탭 동기화: 다른 탭의 비활성화/비밀번호 재설정 시
   * 탭 B가 stale UI를 유지하지 않도록 BroadcastChannel('sscdn-auth') 신호로
   * 사용자 목록을 invalidate (자기 자신이 영향이면 강제 로그아웃, 그 외 invalidate).
   *
   * 이 테스트는 단일 탭에서 BroadcastChannel postMessage를 evaluate로 직접 발생시켜
   * 탭 B 입장의 동작을 시뮬레이션한다 (Playwright context 내 다중 탭은
   * 같은 BroadcastChannel을 공유). user-disabled 이벤트 수신 후 사용자 목록이
   * invalidate되어 disabled 상태가 반영되는지 확인.
   */
  test('다중 탭 동기화 — user-disabled 신호 수신 시 사용자 목록 invalidate (#332)', async ({ page }) => {
    let getCount = 0;
    const baseList = baseUsers;
    const disabledList = baseUsers.map((u) =>
      u.id === 2 ? { ...u, disabled_at: 1778198400 } : u
    );
    await page.route('**/api/users', async (route) => {
      if (route.request().method() === 'GET') {
        getCount += 1;
        // 첫 호출은 활성 상태, 두 번째 호출(invalidate 후)은 비활성 상태로 응답
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(getCount === 1 ? baseList : disabledList),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/users');
    // 초기 활성 상태 확인
    const otherRow = page.getByTestId('user-row-2');
    await expect(otherRow).toHaveAttribute('data-disabled', 'false');

    // 다른 탭에서 발신된 것과 동일한 BroadcastChannel 메시지를 evaluate로 트리거
    // (다른 사용자 id=2 비활성화 → 본인이 아니므로 invalidate만)
    await page.evaluate(() => {
      const ch = new BroadcastChannel('sscdn-auth');
      ch.postMessage({ type: 'user-disabled', userId: 2 });
      ch.close();
    });

    // 사용자 목록이 invalidate되어 재조회되고 비활성 상태가 반영되어야 함
    await expect(otherRow).toHaveAttribute('data-disabled', 'true');
    expect(getCount).toBeGreaterThanOrEqual(2);
  });

  /**
   * 이슈 #332 회귀 방지 — 자기 자신이 영향 대상인 user-disabled 신호 수신 시
   * 강제 로그아웃 + /login 리다이렉트.
   */
  test('다중 탭 동기화 — 본인 user-disabled 신호 수신 시 강제 로그아웃 (#332)', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '사용자', level: 2 })).toBeVisible();

    // 본인 id로 user-disabled 신호 — 강제 로그아웃 → /login 리다이렉트
    await page.evaluate((myId) => {
      const ch = new BroadcastChannel('sscdn-auth');
      ch.postMessage({ type: 'user-disabled', userId: myId });
      ch.close();
    }, TEST_USER.id);

    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * 이슈 #332 회귀 방지 — logout 신호 수신 시 본 탭도 강제 로그아웃 + /login 리다이렉트.
   */
  test('다중 탭 동기화 — logout 신호 수신 시 강제 로그아웃 (#332)', async ({ page }) => {
    await mockApi(page, 'GET', '/users', baseUsers);
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '사용자', level: 2 })).toBeVisible();

    // 다른 탭에서 logout 발신 — 본 탭도 needs_login 전이 + /login
    await page.evaluate(() => {
      const ch = new BroadcastChannel('sscdn-auth');
      ch.postMessage({ type: 'logout' });
      ch.close();
    });

    await expect(page).toHaveURL(/\/login/);
  });
});
