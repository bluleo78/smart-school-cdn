/// 도메인 상세 — 진단 탭 (#387) E2E
/// 빈 상태 표시, URL 입력 시 카드 렌더, 기간 selector 동작, URL searchParams 동기화를 검증.
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';

const HOST = 'textbook.com';

/** 단일 도메인 응답 */
function createDomain() {
  return {
    host: HOST,
    origin: `https://${HOST}`,
    enabled: 1,
    description: '교과서 CDN',
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

/** 도메인 목록 요약 통계 */
function createDomainSummary() {
  return {
    total: 1,
    enabled: 1,
    disabled: 0,
    todayRequests: 0,
    todayRequestsDelta: 0,
    cacheHitRate: 0,
    cacheHitRateDelta: 0,
    todayBandwidth: 0,
    hourlyRequests: Array(24).fill(0),
    hourlyCacheHitRate: Array(24).fill(0),
    hourlyBandwidth: Array(24).fill(0),
    alerts: [],
  };
}

/** 진단 결과 — 데이터 없음 (path 미입력 또는 캐시 사본 없는 경우) */
function diagnoseEmpty() {
  return {
    cdn: null,
    origin: { status: null, avg_rtt_ms: null, error_5xx: 0, timeout_count: 0, sample_count: 0 },
    cache_copy: null,
    response_headers: null,
    range: { single_count: 0, multi_count: 0, none_count: 0 },
    hit_ratio_pct: null,
    sample_count: 0,
  };
}

/** 진단 결과 — HIT 시나리오 (캐시 사본 보유) */
function diagnoseHit() {
  return {
    cdn: { current_state: 'HIT', layer: 'L2', l1_hit: false, l2_hit: true, bypass_count_recent: 0 },
    origin: { status: 'ok', avg_rtt_ms: 180, error_5xx: 0, timeout_count: 0, sample_count: 145 },
    cache_copy: { exists: true, size_bytes: 9846272, stored_at: 1778645000, expires_at: 1778731400 },
    response_headers: [{ name: 'content-type', value: 'video/mp4' }],
    range: { single_count: 142, multi_count: 0, none_count: 3 },
    hit_ratio_pct: 92,
    sample_count: 145,
  };
}

/** 진단 탭 공통 mock — proxy 상태·요청 로그·도메인 요약·도메인 상세를 등록 */
async function setupBaseMocks(page: Page) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
  await mockApi(page, 'GET', `/domains/${HOST}`, createDomain());
}

test.describe('도메인 상세 — 진단 탭 (#387)', () => {
  test('빈 상태에서 path 미입력 시 카드 placeholder + Refresh disabled', async ({ page }) => {
    await setupBaseMocks(page);
    // path 미입력이면 hook enabled=false 라 API 호출이 일어나지 않으나 안전하게 mock 등록
    await page.route(`**/api/domains/${HOST}/diagnose*`, (route) =>
      route.fulfill({ json: diagnoseEmpty() }),
    );

    await page.goto(`/domains/${HOST}?tab=diagnose`);

    // 입력 카드와 결과 카드 헤딩이 모두 표시된다
    // exact: true 로 'Smart School CDN' 헤딩과 구분
    await expect(page.getByTestId('domain-diagnose-input')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CDN', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Origin', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '캐시 사본', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '응답 헤더', exact: true })).toBeVisible();

    // path 미입력 → cache_copy.exists 가 null 이므로 Refresh 버튼 비활성화
    await expect(page.getByTestId('diagnose-refresh-btn')).toBeDisabled();
  });

  test('URL 입력 → 카드 데이터 렌더 + Refresh 활성화', async ({ page }) => {
    await setupBaseMocks(page);
    // query 파라미터가 붙으므로 와일드카드 패턴으로 mock 등록
    await page.route(`**/api/domains/${HOST}/diagnose*`, (route) =>
      route.fulfill({ json: diagnoseHit() }),
    );

    await page.goto(`/domains/${HOST}?tab=diagnose`);
    await page.getByTestId('diagnose-path-input').fill('/v.mp4');

    // 요약 라인에 CDN 상태(HIT + 레이어) 표시
    await expect(page.getByTestId('diagnose-summary')).toContainText('CDN HIT(L2)');
    // 캐시 사본 패널에 파일 크기(MiB 단위) 표시
    await expect(page.getByText(/MiB/)).toBeVisible();
    // cache_copy.exists = true 이므로 Refresh 버튼 활성화
    await expect(page.getByTestId('diagnose-refresh-btn')).toBeEnabled();
  });

  test('path 미검증 — `/` 누락 입력 시 인라인 검증 메시지 노출 (#394)', async ({ page }) => {
    await setupBaseMocks(page);
    // path 가 `/` 로 시작하지 않으면 hook enabled=false 라 API 미호출이지만 안전하게 mock 등록
    await page.route(`**/api/domains/${HOST}/diagnose*`, (route) =>
      route.fulfill({ json: diagnoseEmpty() }),
    );

    await page.goto(`/domains/${HOST}?tab=diagnose`);

    // 정상 입력 시 에러 메시지가 없어야 한다
    await expect(page.getByTestId('diagnose-path-error')).toHaveCount(0);

    // 잘못된 입력 (앞에 / 없음) → 인라인 검증 메시지 노출
    await page.getByTestId('diagnose-path-input').fill('test.mp4');
    const err = page.getByTestId('diagnose-path-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('`/` 로 시작');
    // 접근성: Input 에 aria-invalid 마킹
    await expect(page.getByTestId('diagnose-path-input')).toHaveAttribute('aria-invalid', 'true');
    // 잘못된 입력 동안 Refresh 버튼은 disabled 유지 (불필요한 PURGE 호출 방지)
    await expect(page.getByTestId('diagnose-refresh-btn')).toBeDisabled();

    // 입력 보정 (앞에 / 붙임) → 에러 메시지 사라짐
    await page.getByTestId('diagnose-path-input').fill('/test.mp4');
    await expect(page.getByTestId('diagnose-path-error')).toHaveCount(0);
  });

  test('URL searchParams 동기화 — ?path 와 ?dgRange 가 URL 에 반영된다', async ({ page }) => {
    await setupBaseMocks(page);
    await page.route(`**/api/domains/${HOST}/diagnose*`, (route) =>
      route.fulfill({ json: diagnoseEmpty() }),
    );

    await page.goto(`/domains/${HOST}?tab=diagnose`);
    await page.getByTestId('diagnose-path-input').fill('/v.mp4');

    // path 입력 시 URL searchParams 에 path 와 기본 dgRange 가 동기화된다
    await expect(page).toHaveURL(/[?&]path=%2Fv\.mp4/);
    await expect(page).toHaveURL(/[?&]dgRange=1h/);

    // 기간 버튼 클릭 시 dgRange 가 갱신된다
    await page.getByTestId('diagnose-range-24h').click();
    await expect(page).toHaveURL(/dgRange=24h/);
  });
});
