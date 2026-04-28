/// Setup 페이지 E2E
/// - 이미 setup 완료된 상태에서 /setup 접근 시 409 → 서버 에러 노출
///   (needs_setup 정상 흐름은 admin-server 단위 테스트에서 커버)
/// - 이슈 #131: authenticated/needs_login 상태에서 /setup 직접 접근 시 리다이렉트
import { test, expect } from '../fixtures/test';
import { mockUnauthenticated, mockNeedsSetup } from '../fixtures/auth-mock';

test.describe('Setup', () => {
  test('이미 setup 완료된 상태에서 /setup 접근 → 409 에러 메시지', async ({ page }) => {
    // needs_setup 상태여야 폼이 렌더링됨 (RequireSetup 가드 통과)
    // installAuthDefaults 가 /api/auth/setup 을 409 로 모킹해 둠
    await mockNeedsSetup(page);
    await page.goto('/setup');

    await page.fill('input[name=username]', 'second@example.com');
    await page.fill('input[name=password]', 'password-1234');
    await page.fill('input[name=password_confirm]', 'password-1234');
    await page.getByRole('button', { name: '등록하고 시작하기' }).click();

    // SetupPage 의 409 분기 — server-error 노출
    await expect(page.getByTestId('server-error')).toBeVisible();
    await expect(page.getByTestId('server-error')).toContainText('이미 초기 설정');
  });

  // 이슈 #131 회귀 방지 — authenticated 상태에서 /setup 직접 접근 시 / 로 리다이렉트
  test('authenticated 상태에서 /setup 접근 → / 로 리다이렉트', async ({ page }) => {
    // 기본 모킹(authenticated)이 설치된 상태에서 /setup 직접 접근
    // RequireSetup 가드가 / 로 리다이렉트해야 한다
    await page.goto('/setup');

    // /setup 폼이 렌더링되지 않고 대시보드(/)로 이동해야 한다
    await expect(page).not.toHaveURL(/\/setup/);
    await expect(page).toHaveURL('http://localhost:4173/');
  });

  // 이슈 #131 회귀 방지 — needs_login 상태에서 /setup 직접 접근 시 /login 으로 리다이렉트
  test('needs_login 상태에서 /setup 접근 → /login 으로 리다이렉트', async ({ page }) => {
    // needs_login 상태로 강제 — 설치 완료 후 로그아웃/세션 만료 상태
    await mockUnauthenticated(page);

    await page.goto('/setup');

    // /setup 폼이 렌더링되지 않고 /login 으로 이동해야 한다
    await expect(page).toHaveURL(/\/login/);
  });

  // 이슈 #76 회귀 방지 — SetupPage 비밀번호 필드 표시/숨기기 토글 버튼 없음
  test('비밀번호 필드 — 표시/숨기기 토글 각 필드 독립 동작', async ({ page }) => {
    // needs_setup 상태여야 폼이 렌더링됨 (RequireSetup 가드 통과)
    await mockNeedsSetup(page);
    await page.goto('/setup');

    // 두 필드 모두 기본값: type=password (숨김 상태)
    const passwordInput = page.locator('input[name=password]');
    const confirmInput = page.locator('input[name=password_confirm]');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await expect(confirmInput).toHaveAttribute('type', 'password');

    // 비밀번호 필드 토글 — 비밀번호 확인 필드에 영향 없어야 함 (독립 상태)
    const toggleButtons = page.getByRole('button', { name: '비밀번호 표시' });
    await toggleButtons.first().click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(confirmInput).toHaveAttribute('type', 'password');

    // 비밀번호 확인 필드 토글
    await toggleButtons.last().click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(confirmInput).toHaveAttribute('type', 'text');
  });
});
