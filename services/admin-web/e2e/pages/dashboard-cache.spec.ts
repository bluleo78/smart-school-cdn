/// 대시보드 캐시 카드 E2E 테스트 (재설계 후)
/// L1/엣지/BYPASS 카드, 스택 차트, 도메인 표, 인기 콘텐츠, 전체 퍼지를 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createCacheSeriesBuckets, createPopularContent } from '../factories/cache.factory';

/** 대시보드 페이지에 필요한 공통 API 목을 설정한다 */
async function setupDashboardMocks(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', '/proxy/status', { status: 'online', uptime: 3600, total_requests: 42 });
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
  await page.route('**/api/cache/series*', (route) =>
    route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
  );
}

// ─── L1 히트율 · 스택 차트 · 도메인 표 렌더 ─────────────────
test.describe('대시보드 — 캐시 재설계 카드 렌더링', () => {
  test('L1 히트율 카드 · 엣지 히트율 카드 · BYPASS 카드 · 스택 차트 · 도메인 표 렌더', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');
    await expect(page.getByTestId('dashboard-l1-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-edge-hit-rate')).toBeVisible();
    await expect(page.getByTestId('dashboard-bypass-rate')).toBeVisible();
    await expect(page.getByTestId('cache-stacked-chart')).toBeVisible();
    await expect(page.getByTestId('by-domain-table')).toBeVisible();
  });

  test('1h/24h 토글 시 /api/cache/series?range=24h 요청', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');
    const req = page.waitForRequest(
      (r) => r.url().includes('/api/cache/series') && r.url().includes('range=24h'),
    );
    await page.getByTestId('cache-range-24h').click();
    await req;
  });

  // 회귀 테스트: #47 — 범위 토글 버튼에 aria-pressed ARIA 상태 속성 누락
  test('범위 토글 버튼에 aria-pressed 속성이 올바르게 반영된다 (#47)', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    const btn1h = page.getByTestId('cache-range-1h');
    const btn24h = page.getByTestId('cache-range-24h');

    // 초기 상태: 1시간이 선택(true), 24시간은 미선택(false)
    await expect(btn1h).toHaveAttribute('aria-pressed', 'true');
    await expect(btn24h).toHaveAttribute('aria-pressed', 'false');

    // 24시간 클릭 후: 상태 반전
    await btn24h.click();
    await expect(btn24h).toHaveAttribute('aria-pressed', 'true');
    await expect(btn1h).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─── 인기 콘텐츠 테이블 ───────────────────────────────────────
test.describe('대시보드 — 인기 콘텐츠', () => {
  test('인기 콘텐츠 Top 5 테이블이 렌더링된다', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    await expect(page.getByText('인기 콘텐츠 Top 5')).toBeVisible();
    await expect(page.getByText('cdn.textbook.com').first()).toBeVisible();
    await expect(page.getByText('/images/cover.png')).toBeVisible();
    await expect(page.getByText('/assets/chapter1.pdf')).toBeVisible();
    await expect(page.getByText('412')).toBeVisible();
    await expect(page.getByText('387')).toBeVisible();
  });

  // 회귀 테스트: shadcn Table 컴포넌트 사용 여부 검증 (#10)
  // 네이티브 <table> 대신 shadcn Table이 렌더되면 data-testid="popular-content-table"이 존재한다
  test('인기 콘텐츠 테이블이 shadcn Table 컴포넌트로 렌더링된다 (#10)', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    // shadcn Table 컴포넌트로 교체되면 data-testid 가 DOM에 존재
    await expect(page.getByTestId('popular-content-table')).toBeVisible();
    // TableHeader(thead)와 TableBody(tbody)가 존재하는지 확인
    const table = page.getByTestId('popular-content-table');
    await expect(table.locator('thead')).toBeVisible();
    await expect(table.locator('tbody')).toBeVisible();
  });
});

// ─── 전체 캐시 퍼지 ──────────────────────────────────────────
test.describe('대시보드 — 전체 캐시 퍼지', () => {
  test('전체 캐시 퍼지 버튼 → 확인 다이얼로그 → 닫힘', async ({ page }) => {
    await setupDashboardMocks(page);
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 100, freed_bytes: 1048576 });

    await page.goto('/');

    await page.getByRole('button', { name: '전체 캐시 퍼지' }).click();
    await expect(page.getByText('전체 캐시 퍼지').nth(1)).toBeVisible();

    await page.getByRole('button', { name: '퍼지 실행' }).click();
    await expect(page.getByRole('button', { name: '퍼지 실행' })).not.toBeVisible();
  });
});

// ─── 헤더 한국어 통일 (#49 회귀) ─────────────────────────────
test.describe('대시보드 — 헤더 한국어 통일 (#49)', () => {
  test('도메인별 캐시 지표 테이블 헤더가 한국어로 표시된다 — "Host" 잔존 없음', async ({ page }) => {
    await setupDashboardMocks(page);
    await page.goto('/');

    // by-domain 테이블에 도메인 데이터가 렌더될 때까지 대기
    const table = page.getByTestId('by-domain-table');
    await expect(table).toBeVisible();

    // "호스트" 헤더 존재 확인 (한국어 통일)
    await expect(table.getByRole('columnheader', { name: '호스트' })).toBeVisible();

    // 영문 "Host" 헤더가 없어야 한다 (회귀 방지)
    await expect(table.getByRole('columnheader', { name: 'Host' })).not.toBeVisible();
  });

  test('최근 요청 테이블 헤더가 한국어로 표시된다 — "Host"/"URL" 잔존 없음', async ({ page }) => {
    // 요청 로그 데이터가 있어야 헤더가 렌더됨 — setupDashboardMocks 이후 재정의로 우선순위 확보
    const { createRequestLogs } = await import('../factories/proxy.factory');
    await setupDashboardMocks(page);
    await mockApi(page, 'GET', '/proxy/requests', createRequestLogs());
    await page.goto('/');

    // "최근 요청" 카드가 로그 데이터와 함께 렌더될 때까지 대기
    await expect(page.getByText('httpbin.org')).toBeVisible();

    // 최근 요청 카드 영역을 heading으로 스코프해 다른 테이블의 "호스트" 헤더와 충돌 방지
    const requestCard = page.locator('text=최근 요청').locator('..').locator('..');

    // "호스트", "경로" 헤더 존재 확인 (한국어 통일)
    await expect(requestCard.getByRole('columnheader', { name: '호스트' })).toBeVisible();
    await expect(requestCard.getByRole('columnheader', { name: '경로' })).toBeVisible();

    // 영문 헤더가 없어야 한다 (회귀 방지)
    await expect(requestCard.getByRole('columnheader', { name: 'Host' })).not.toBeVisible();
    await expect(requestCard.getByRole('columnheader', { name: 'URL' })).not.toBeVisible();
  });
});

// ─── Tooltip 포맷 (#86 회귀) ─────────────────────────────────
test.describe('대시보드 — CacheHitRateChart Tooltip 포맷 (#86)', () => {
  test('스택 차트 hover tooltip이 소수 대신 % 형식으로 표시된다', async ({ page }) => {
    // 버그: stackOffset="expand" 사용 시 Recharts 내부값(0~1 소수)이 tooltip에 그대로 노출됨
    // 수정 후: formatter가 Math.round(v * 100)% 변환을 적용해야 한다
    await setupDashboardMocks(page);
    await page.goto('/');

    // 차트가 렌더링될 때까지 대기
    const chart = page.getByTestId('cache-stacked-chart');
    await expect(chart).toBeVisible();

    // 차트 SVG 위로 마우스를 이동해 tooltip을 활성화한다
    const chartBox = await chart.boundingBox();
    if (chartBox) {
      await page.mouse.move(
        chartBox.x + chartBox.width * 0.4,
        chartBox.y + chartBox.height * 0.5,
      );
    }

    // Recharts tooltip이 DOM에 추가되기를 기다린다 (.recharts-tooltip-wrapper)
    const tooltip = page.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // tooltip 텍스트에 '%'가 포함되어야 한다 (소수 원시값 0.xx 노출 방지)
    await expect(tooltip).toContainText('%');

    // tooltip 텍스트에 소수 패턴(0.숫자숫자)이 없어야 한다 (예: 0.75, 0.7500000000000001)
    const tooltipText = await tooltip.textContent();
    expect(tooltipText).not.toMatch(/\b0\.\d{2,}/);
  });
});

// ─── BYPASS 사유 한국어 통일 (#93 회귀) ──────────────────────
test.describe('대시보드 — BYPASS 사유 세부 한국어 통일 (#93)', () => {
  test('BYPASS 사유 레이블이 한국어로 표시된다 — 영문 잔존 없음', async ({ page }) => {
    // 버그: CacheStatsCard의 BYPASS 4분류 레이블이 영문(METHOD/NOCACHE/SIZE/OTHER)으로 하드코딩됨
    // 수정 후: 메서드 불일치/캐시 불가/크기 초과/기타로 표시되어야 함
    await setupDashboardMocks(page);
    await page.goto('/');

    const card = page.getByTestId('cache-stats-card');
    await expect(card).toBeVisible();

    // 한국어 레이블이 모두 표시되어야 한다
    await expect(card.getByText('메서드 불일치')).toBeVisible();
    await expect(card.getByText('캐시 불가')).toBeVisible();
    await expect(card.getByText('크기 초과')).toBeVisible();
    await expect(card.getByText('기타')).toBeVisible();

    // 영문 레이블이 없어야 한다 (회귀 방지)
    const breakdown = page.getByTestId('bypass-breakdown');
    await expect(breakdown.getByText('METHOD', { exact: true })).not.toBeVisible();
    await expect(breakdown.getByText('NOCACHE', { exact: true })).not.toBeVisible();
    await expect(breakdown.getByText('SIZE', { exact: true })).not.toBeVisible();
    await expect(breakdown.getByText('OTHER', { exact: true })).not.toBeVisible();
  });
});

// ─── 타임스탬프 날짜+시간 표시 (#105 회귀) ───────────────────────
test.describe('대시보드 — 최근 요청 타임스탬프 날짜+시간 표시 (#105)', () => {
  test('최근 요청 테이블 "시간" 컬럼이 날짜+시간(YYYY. M. D.)을 포함해 표시된다', async ({ page }) => {
    // 버그: formatTime이 toLocaleTimeString만 써서 HH:MM:SS만 노출됨
    // 수정 후: formatDateTime 유틸로 교체 → ko-KR 날짜+시간 포맷(YYYY. M. D. HH:MM:SS)
    const { createRequestLogs } = await import('../factories/proxy.factory');
    await setupDashboardMocks(page);
    // 날짜가 명확한 고정 타임스탬프 사용 — 2026. 4. 11. 형태로 렌더되어야 한다
    await mockApi(page, 'GET', '/proxy/requests', createRequestLogs());
    await page.goto('/');

    // "최근 요청" 카드가 로그 데이터와 함께 렌더될 때까지 대기
    await expect(page.getByText('httpbin.org')).toBeVisible();

    // "시간" 컬럼 셀에 날짜 부분(연·월·일)이 포함되어야 한다 — 시간만 표시 금지
    // ko-KR toLocaleString은 "2026. 4. 11. 21:00:00" 형태 (KST = UTC+9)
    const requestCard = page.locator('text=최근 요청').locator('..').locator('..');
    const timeCell = requestCard.locator('tbody tr').first().locator('td').first();
    const cellText = await timeCell.textContent();
    // 날짜 부분이 있는지 확인: "2026" 또는 "." 두 개 이상 포함(ko-KR 날짜 형식)
    expect(cellText).toMatch(/\d{4}/); // 연도 4자리 포함 여부
    // 시간만 표시하는 패턴(HH:MM:SS 형태만 있고 날짜 없음)이 아닌지 확인
    expect(cellText).not.toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

// ─── 도메인별 캐시 지표 행 키보드 접근성 (#108 회귀) ─────────
test.describe('대시보드 — ByDomainTable 키보드 접근성 (#108)', () => {
  test('도메인 행에 tabIndex=0 / role=link 속성이 있다', async ({ page }) => {
    // 버그: TableRow에 onClick만 있고 tabIndex/role이 없어 키보드 포커스 불가
    // 수정 후: tabIndex={0} + role="link" 추가로 Tab 포커스 지원
    await setupDashboardMocks(page);
    await page.goto('/');

    // 도메인 행이 렌더될 때까지 대기
    const row = page.getByTestId('by-domain-row-a.test');
    await expect(row).toBeVisible();

    // tabIndex="0" — Tab으로 포커스 가능해야 한다
    await expect(row).toHaveAttribute('tabindex', '0');
    // role="link" — 보조 기술이 링크로 인식해야 한다
    await expect(row).toHaveAttribute('role', 'link');
  });

  test('도메인 행에서 Enter 키로 도메인 상세 페이지로 이동한다', async ({ page }) => {
    // 버그: onKeyDown 없어 Enter/Space가 탐색을 트리거하지 않음
    // 수정 후: Enter/Space로 navigate('/domains/:host') 호출
    await setupDashboardMocks(page);
    await page.goto('/');

    const row = page.getByTestId('by-domain-row-a.test');
    await expect(row).toBeVisible();

    // 행에 포커스를 옮기고 Enter 키 입력 → 도메인 상세 페이지로 이동해야 한다
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/domains/a.test');
  });

  test('도메인 행에서 Space 키로 도메인 상세 페이지로 이동한다', async ({ page }) => {
    // Space 키 처리 검증 — e.preventDefault()로 페이지 스크롤 방지 후 navigate 실행
    await setupDashboardMocks(page);
    await page.goto('/');

    const row = page.getByTestId('by-domain-row-a.test');
    await expect(row).toBeVisible();

    await row.focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL('/domains/a.test');
  });
});

// ─── 빈 데이터 empty state (#21 회귀) ─────────────────────────
test.describe('대시보드 — 캐시 스택 차트 empty state (#21)', () => {
  test('시계열 데이터가 없으면 차트 대신 empty state 메시지가 표시된다', async ({ page }) => {
    // 빈 버킷 배열 → data.length === 0 분기 진입 검증
    await mockApi(page, 'GET', '/proxy/status', { status: 'online', uptime: 3600, total_requests: 0 });
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: [] } }),
    );

    await page.goto('/');

    // 캐시 결과 분포 카드 안에 empty state 문구가 노출되어야 한다
    const chart = page.getByTestId('cache-stacked-chart');
    await expect(chart).toBeVisible();
    await expect(chart.getByText('아직 데이터가 없습니다')).toBeVisible();
    await expect(chart.getByText('프록시로 요청이 들어오면 자동으로 표시됩니다')).toBeVisible();
  });
});
