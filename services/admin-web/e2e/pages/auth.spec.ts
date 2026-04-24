/// 인증 페이지 E2E
/// - 비로그인 상태에서 보호 경로 접근 → /login 리다이렉트
/// - 잘못된 자격증명 → 서버 에러 메시지
/// - 올바른 자격증명 → / 로 이동
/// - 로그인 후 로그아웃 → /login 이동
import { test, expect } from '../fixtures/test';
import { mockUnauthenticated, mockLoginFailure } from '../fixtures/auth-mock';

test.describe('인증', () => {
  test('비로그인 상태에서 보호 경로 접근 → /login 리다이렉트', async ({ page }) => {
    // /api/auth/state → needs_login 으로 재정의 (기본 모킹은 authenticated)
    await mockUnauthenticated(page);

    await page.goto('/');

    // RequireAuth 가드가 /login?from=... 으로 리다이렉트해야 한다
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  });

  test('잘못된 자격증명 → 에러 메시지', async ({ page }) => {
    await mockUnauthenticated(page);
    await mockLoginFailure(page);

    await page.goto('/login');
    await page.fill('input[name=username]', 'wrong@example.com');
    await page.fill('input[name=password]', 'wrong-pass-1');
    await page.getByRole('button', { name: '로그인' }).click();

    // server-error 영역에 "올바르지" 문구 노출 (LoginPage 의 401 분기)
    await expect(page.getByTestId('server-error')).toContainText('올바르지');
  });

  test('올바른 자격증명 → / 로 이동', async ({ page }) => {
    // 시작 상태는 needs_login, 로그인 성공 후 AuthContext 가 즉시 authenticated 로 갱신
    await mockUnauthenticated(page);

    await page.goto('/login');
    await page.fill('input[name=username]', 'test@example.com');
    await page.fill('input[name=password]', 'test-password-1');
    await page.getByRole('button', { name: '로그인' }).click();

    // 대시보드(/)로 리다이렉트
    await expect(page).toHaveURL('http://localhost:4173/');
  });

  test('로그인 후 로그아웃 → /login 이동', async ({ page }) => {
    // 기본 모킹(authenticated)으로 바로 대시보드 진입
    await page.goto('/');

    // 헤더의 로그아웃 버튼 클릭 → AppLayout 이 navigate('/login', replace) 수행
    await page.getByRole('button', { name: '로그아웃' }).click();

    await expect(page).toHaveURL(/\/login/);
  });
});
