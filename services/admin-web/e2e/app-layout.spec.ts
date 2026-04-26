import { test, expect } from './fixtures/test';
import { mockApi } from './fixtures/api-mock';
import { mockUnauthenticated } from './fixtures/auth-mock';

test.describe('AppLayout', () => {
  test('사이드바와 대시보드 페이지가 렌더링된다', async ({ page }) => {
    await page.goto('/');

    // 사이드바 타이틀
    await expect(page.getByText('Smart School CDN')).toBeVisible();

    // 사이드바 네비게이션 항목 — 4개 존재 (대시보드/도메인/DNS/시스템)
    await expect(page.getByRole('link', { name: '대시보드' })).toBeVisible();
    await expect(page.getByRole('link', { name: '도메인 관리' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'DNS' })).toBeVisible();
    await expect(page.getByRole('link', { name: '시스템' })).toBeVisible();

    // 제거된 메뉴 항목이 없음을 확인
    await expect(page.getByRole('link', { name: '캐시 관리' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: '최적화' })).not.toBeVisible();

    // 대시보드 페이지 콘텐츠
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  });

  test('사이드바 네비게이션으로 페이지 이동이 동작한다', async ({ page }) => {
    await page.goto('/');

    // 도메인 관리 페이지로 이동
    await page.getByRole('link', { name: '도메인 관리' }).click();
    await expect(page.getByRole('heading', { name: '도메인 관리' })).toBeVisible();

    // 시스템 페이지로 이동
    await page.getByRole('link', { name: '시스템' }).click();
    await expect(page.getByRole('heading', { name: '시스템' })).toBeVisible();

    // 대시보드로 복귀
    await page.getByRole('link', { name: '대시보드' }).click();
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  });

  test('헤더가 현재 라우트에 맞는 페이지 제목을 표시한다', async ({ page }) => {
    // 각 라우트마다 헤더에 올바른 페이지 제목이 표시되는지 검증
    // (빈 div placeholder 제거 → 실제 제목 노출 회귀 방지)
    // /users 라우트는 사용자 목록 API 모킹 필요 — 없으면 로딩 후 빈 상태로 렌더링됨
    await mockApi(page, 'GET', '/users', []);

    const cases: { path: string; label: string }[] = [
      { path: '/', label: '대시보드' },
      { path: '/domains', label: '도메인 관리' },
      { path: '/dns', label: 'DNS' },
      { path: '/users', label: '사용자 관리' },
      { path: '/system', label: '시스템' },
    ];

    for (const { path, label } of cases) {
      await page.goto(path);
      // banner role = <header> — 그 안에 페이지 제목 span이 포함돼야 함
      await expect(page.getByRole('banner').getByText(label)).toBeVisible();
    }
  });

  test('LoginPage — 탭 제목이 "로그인 | Smart School CDN"으로 표시된다', async ({ page }) => {
    // AppLayout 바깥 페이지의 document.title 미설정 회귀를 방지 (#74)
    // needs_login 상태로 /login에 직접 접근하여 title 확인
    await mockUnauthenticated(page);
    await page.goto('/login');
    await expect(page).toHaveTitle('로그인 | Smart School CDN');
  });

  test('SetupPage — 탭 제목이 "초기 설정 | Smart School CDN"으로 표시된다', async ({ page }) => {
    // AppLayout 바깥 페이지의 document.title 미설정 회귀를 방지 (#74)
    // needs_setup 상태를 모킹하여 /setup 접근 — setup API 200으로 페이지 렌더링 허용
    await page.route('**/api/auth/state', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'needs_setup' }),
      });
    });
    await page.goto('/setup');
    await expect(page).toHaveTitle('초기 설정 | Smart School CDN');
  });

  test('/cache 접근 시 /domains로 리다이렉트된다', async ({ page }) => {
    await page.goto('/cache');
    await expect(page).toHaveURL('/domains');
  });

  test('/optimizer 접근 시 /domains로 리다이렉트된다', async ({ page }) => {
    await page.goto('/optimizer');
    await expect(page).toHaveURL('/domains');
  });
});
