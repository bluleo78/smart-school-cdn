/// 인증 API 모킹 헬퍼
/// admin-web 은 RequireAuth 가드가 모든 보호 라우트를 감싸므로 E2E 가 페이지에 접근하려면
/// /api/auth/state 가 'authenticated' 를 반환해야 한다. 백엔드 없이도 동작하도록 픽스처가
/// 기본 모킹을 설치하고, 로그인/로그아웃 플로우를 검증하는 스펙은 mockUnauthenticated 등으로 재정의한다.
import type { Page } from '@playwright/test';

/** E2E 기본 테스트 사용자 — needs_setup 상태가 아닌 일반 로그인 상태를 가정 */
export const TEST_USER = {
  id: 1,
  username: 'test@example.com',
  last_login_at: '2026-04-25T00:00:00.000Z',
};

/**
 * 인증 기본 모킹 설치.
 * - GET /api/auth/state → authenticated
 * - POST /api/auth/logout → 204
 * - POST /api/auth/login → user 반환
 * - POST /api/auth/setup → 409 (이미 setup 완료 상태 가정)
 */
export async function installAuthDefaults(page: Page) {
  await page.route('**/api/auth/state', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'authenticated', user: TEST_USER }),
    });
  });

  await page.route('**/api/auth/logout', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/auth/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }),
    });
  });

  await page.route('**/api/auth/setup', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'already_set_up' }),
    });
  });
}

/**
 * needs_setup 상태로 강제 — /setup 접근 시 폼이 렌더링되어야 한다.
 * RequireSetup 가드 통과 테스트 및 SetupPage 기능 검증에 사용한다.
 */
export async function mockNeedsSetup(page: Page) {
  await page.route('**/api/auth/state', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'needs_setup' }),
    });
  });
}

/** 비로그인 상태로 강제 — 보호 라우트 접근 시 /login 리다이렉트가 일어나야 한다. */
export async function mockUnauthenticated(page: Page) {
  await page.route('**/api/auth/state', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'needs_login' }),
    });
  });
}

/** 잘못된 자격증명으로 로그인 실패를 시뮬레이션 — 401 반환 */
export async function mockLoginFailure(page: Page) {
  await page.route('**/api/auth/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_credentials' }),
    });
  });
}
