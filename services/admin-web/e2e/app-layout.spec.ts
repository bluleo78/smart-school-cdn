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

  test('NotFoundPage — 헤더 제목·document.title·시맨틱 헤딩이 404 상태를 명시한다 (#180)', async ({ page }) => {
    // 존재하지 않는 경로에 직접 접근했을 때 사용자가 404 상태를 인지할 수 있는지 검증.
    // 회귀 방지: 헤더가 빈 문자열로 떨어지거나 document.title이 "Smart School CDN"으로
    // 떨어져 페이지 식별 불가하던 버그 재발 방지.
    await page.goto('/totally-bogus-page-xyz');

    // document.title — WCAG 2.4.2 Page Titled
    await expect(page).toHaveTitle('페이지를 찾을 수 없음 | Smart School CDN');

    // 헤더(banner) 페이지 제목 영역
    await expect(
      page.getByRole('banner').getByText('페이지를 찾을 수 없음'),
    ).toBeVisible();

    // 본문 시맨틱 헤딩 — 스크린리더 사용자가 페이지 구조 인지 가능
    await expect(
      page.getByRole('heading', { name: '페이지를 찾을 수 없습니다.' }),
    ).toBeVisible();

    // 대시보드 복귀 CTA가 정상 노출되는지
    await expect(page.getByRole('link', { name: '대시보드로 돌아가기' })).toBeVisible();
  });

  test.describe('NotFoundPage prefix 매칭 회귀 (#323)', () => {
    // 등록된 nav path의 prefix는 일치하지만 세그먼트 경계가 다른 경로
    // (예: /system-extra, /usersxxx, /dnsfoo)에서도 NotFoundPage가 렌더링되어야 하고,
    // 헤더 라벨/document.title은 부모 메뉴 라벨이 아니라 "페이지를 찾을 수 없음"이어야 한다.
    // 회귀 방지: startsWith 단순 매칭으로 인한 false-positive 재발 차단.
    const cases: { path: string; wrongLabel: string }[] = [
      { path: '/system-extra', wrongLabel: '시스템' },
      { path: '/usersxxx', wrongLabel: '사용자 관리' },
      { path: '/dnsfoo', wrongLabel: 'DNS' },
    ];

    for (const { path, wrongLabel } of cases) {
      test(`${path} — 부모 메뉴 라벨(${wrongLabel}) 대신 404 라벨이 노출된다`, async ({
        page,
      }) => {
        await page.goto(path);

        // 본문은 404
        await expect(
          page.getByRole('heading', { name: '페이지를 찾을 수 없습니다.' }),
        ).toBeVisible();

        // document.title — 부모 메뉴가 아닌 "페이지를 찾을 수 없음"
        await expect(page).toHaveTitle('페이지를 찾을 수 없음 | Smart School CDN');

        // 헤더 라벨 — 부모 메뉴 라벨이 보이면 안 됨
        await expect(
          page.getByRole('banner').getByText('페이지를 찾을 수 없음'),
        ).toBeVisible();
        await expect(
          page.getByRole('banner').getByText(wrongLabel, { exact: true }),
        ).toHaveCount(0);
      });
    }

    test('/dns/random-subpath — 등록된 prefix + 추가 세그먼트는 부모 라벨을 유지한다', async ({
      page,
    }) => {
      // 정상 매칭 케이스(`/dns/...`)는 그대로 부모 라벨을 유지해야 한다.
      // 단, 라우터 트리에 매칭되는 자식 라우트가 없으면 NotFoundPage가 렌더링될 수 있는데
      // 이 경우 헤더는 'DNS'이고 본문이 404가 된다. 본문 라벨/타이틀은 단순 케이스만 검증.
      await page.goto('/dns/random-subpath');
      // 헤더 라벨은 'DNS' — segment 경계 매칭 통과
      await expect(page.getByRole('banner').getByText('DNS')).toBeVisible();
    });
  });

  test.describe('모바일 사이드바 닫기 (#320)', () => {
    // 모바일 viewport(iPad portrait)에서 사이드바를 연 뒤
    // ESC 키와 X(닫기) 버튼이 모두 동작하는지 회귀 방지.
    // 기존에는 닫기 경로가 백드롭 탭 1개뿐이라 키보드 사용자 진입이 막혀 있었다.
    test.use({ viewport: { width: 820, height: 1180 } });

    test('ESC 키로 모바일 사이드바가 닫힌다', async ({ page }) => {
      await page.goto('/domains');

      // 햄버거 버튼 클릭 → 사이드바 슬라이드 인
      await page.getByRole('button', { name: '메뉴 열기' }).click();
      const aside = page.locator('aside');
      // translate-x-0 상태 — 화면 좌측에 노출
      await expect(aside).toHaveClass(/translate-x-0/);

      // ESC keydown — window 리스너로 처리되어 사이드바가 닫혀야 함
      await page.keyboard.press('Escape');

      // -translate-x-full로 다시 숨겨졌는지 검증
      await expect(aside).toHaveClass(/-translate-x-full/);
    });

    test('사이드바 헤더 X 버튼으로 모바일 사이드바가 닫힌다', async ({ page }) => {
      await page.goto('/domains');

      await page.getByRole('button', { name: '메뉴 열기' }).click();
      const aside = page.locator('aside');
      await expect(aside).toHaveClass(/translate-x-0/);

      // 사이드바 헤더 우측 X(닫기) 버튼
      await page.getByRole('button', { name: '메뉴 닫기' }).click();

      await expect(aside).toHaveClass(/-translate-x-full/);
    });

    test('백드롭 클릭으로 모바일 사이드바가 닫힌다', async ({ page }) => {
      await page.goto('/domains');

      await page.getByRole('button', { name: '메뉴 열기' }).click();
      const aside = page.locator('aside');
      await expect(aside).toHaveClass(/translate-x-0/);

      // 백드롭(aria-hidden div)을 force click으로 탭 — 명시적 close 경로 검증
      await page
        .locator('div[aria-hidden="true"].fixed.inset-0')
        .click({ position: { x: 700, y: 400 } });

      await expect(aside).toHaveClass(/-translate-x-full/);
    });
  });

  test('브라우저 뒤로가기 시 이전 페이지 스크롤 위치가 복원된다 (#324)', async ({ page }) => {
    // #146 후속: PUSH 시에는 0으로 초기화하되, POP(브라우저 뒤로/앞으로)에서는
    // 이전 scrollTop을 복원해야 한다. 기존엔 location.pathname만 의존해 POP에서도 0으로 리셋됐다.
    await page.goto('/system');

    // 메인 콘텐츠 영역을 일정 위치까지 스크롤
    const main = page.locator('main');
    await main.evaluate((el) => {
      el.scrollTop = 600;
    });
    const scrollBefore = await main.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);

    // PUSH로 다른 페이지 이동 — 이때는 상단으로 초기화되어야 한다 (#146 동작 유지)
    await page.getByRole('link', { name: 'DNS' }).click();
    await expect(page.getByRole('heading', { name: 'DNS' })).toBeVisible();
    expect(await main.evaluate((el) => el.scrollTop)).toBe(0);

    // 브라우저 뒤로가기(POP) — /system으로 복귀했을 때 이전 scrollTop으로 돌아가야 한다
    await page.goBack();
    await expect(page.getByRole('heading', { name: '시스템' })).toBeVisible();
    // scroll 복원 검증 — 콘텐츠 height가 렌더 사이 약간 변할 수 있어 정확값 비교 대신
    // "유의미하게 복원됐는가"(0이 아니라 이전 위치 근처)를 확인한다.
    await expect
      .poll(async () => main.evaluate((el) => el.scrollTop), {
        timeout: 2000,
      })
      .toBeGreaterThan(scrollBefore * 0.5);
  });

  test('페이지 이동 시 메인 콘텐츠 스크롤이 상단으로 초기화된다 (#146)', async ({ page }) => {
    // 시스템 페이지(긴 콘텐츠)에서 스크롤 후 다른 페이지로 이동하면
    // 이전 스크롤 위치가 유지되는 버그 회귀 방지
    await page.goto('/system');

    // 메인 콘텐츠 영역을 스크롤 다운
    const main = page.locator('main');
    await main.evaluate((el) => {
      el.scrollTop = 800;
    });
    const scrollBefore = await main.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);

    // React Router SPA 네비게이션으로 다른 페이지로 이동
    await page.getByRole('link', { name: 'DNS' }).click();
    await expect(page.getByRole('heading', { name: 'DNS' })).toBeVisible();

    // 메인 콘텐츠 영역이 상단으로 초기화되어야 한다
    const scrollAfter = await main.evaluate((el) => el.scrollTop);
    expect(scrollAfter).toBe(0);
  });
});
