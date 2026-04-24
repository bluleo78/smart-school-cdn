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
});
