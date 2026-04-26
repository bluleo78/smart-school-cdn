/// 인증 페이지 E2E
/// - 비로그인 상태에서 보호 경로 접근 → /login 리다이렉트
/// - 잘못된 자격증명 → 서버 에러 메시지
/// - 올바른 자격증명 → / 로 이동
/// - 로그인 후 로그아웃 → /login 이동
/// - from 파라미터 외부 URL → / 로 fallback (Open Redirect 방어)
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

    // 사이드바 하단 UserNav 트리거(드롭다운) 클릭 후 메뉴 안 로그아웃 항목 클릭
    await page.locator('[aria-haspopup="menu"]').click();
    await page.getByTestId('user-nav-logout').click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('from 파라미터 외부 절대 URL → 로그인 후 / 로 fallback (Open Redirect 방어)', async ({ page }) => {
    // Open Redirect 취약점 회귀 테스트 (#3)
    // from=http://evil.example.com 같은 외부 URL이 주입돼도 로그인 후 홈(/)으로만 이동해야 한다
    await mockUnauthenticated(page);

    await page.goto('/login?from=http://evil.example.com');
    await page.fill('input[name=username]', 'test@example.com');
    await page.fill('input[name=password]', 'test-password-1');
    await page.getByRole('button', { name: '로그인' }).click();

    // 외부 URL 리다이렉트가 차단되고 동일 origin의 홈으로 이동해야 한다
    await expect(page).toHaveURL('http://localhost:4173/');
  });

  test('from 파라미터 protocol-relative URL(//) → 로그인 후 / 로 fallback', async ({ page }) => {
    // //evil.example.com 형태의 protocol-relative URL도 외부 리다이렉트로 차단해야 한다
    await mockUnauthenticated(page);

    await page.goto('/login?from=//evil.example.com');
    await page.fill('input[name=username]', 'test@example.com');
    await page.fill('input[name=password]', 'test-password-1');
    await page.getByRole('button', { name: '로그인' }).click();

    // protocol-relative URL도 차단되어 홈으로 이동해야 한다
    await expect(page).toHaveURL('http://localhost:4173/');
  });

  test('from 파라미터 유효한 내부 경로 → 로그인 후 해당 경로로 이동', async ({ page }) => {
    // 정상 케이스: 내부 경로(/domains)는 그대로 리다이렉트되어야 한다
    await mockUnauthenticated(page);

    await page.goto('/login?from=/domains');
    await page.fill('input[name=username]', 'test@example.com');
    await page.fill('input[name=password]', 'test-password-1');
    await page.getByRole('button', { name: '로그인' }).click();

    // 내부 경로로 정상 이동해야 한다
    await expect(page).toHaveURL('http://localhost:4173/domains');
  });
});
