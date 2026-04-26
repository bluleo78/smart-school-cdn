/// Setup 페이지 E2E
/// - 이미 setup 완료된 상태에서 /setup 접근 시 409 → 서버 에러 노출
///   (needs_setup 정상 흐름은 admin-server 단위 테스트에서 커버)
import { test, expect } from '../fixtures/test';

test.describe('Setup', () => {
  test('이미 setup 완료된 상태에서 /setup 접근 → 409 에러 메시지', async ({ page }) => {
    // installAuthDefaults 가 /api/auth/setup 을 409 로 모킹해 둠
    await page.goto('/setup');

    await page.fill('input[name=username]', 'second@example.com');
    await page.fill('input[name=password]', 'password-1234');
    await page.fill('input[name=password_confirm]', 'password-1234');
    await page.getByRole('button', { name: '등록하고 시작하기' }).click();

    // SetupPage 의 409 분기 — server-error 노출
    await expect(page.getByTestId('server-error')).toBeVisible();
    await expect(page.getByTestId('server-error')).toContainText('이미 초기 설정');
  });

  // 이슈 #76 회귀 방지 — SetupPage 비밀번호 필드 표시/숨기기 토글 버튼 없음
  test('비밀번호 필드 — 표시/숨기기 토글 각 필드 독립 동작', async ({ page }) => {
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
