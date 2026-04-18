/// 도메인 상세 페이지 E2E 테스트
/// Overview(개요), Stats(통계), Settings(설정) 3개 탭의 핵심 시나리오를 검증한다.
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';

// ─────────────────────────────────────────────
// 테스트 데이터 팩토리
// ─────────────────────────────────────────────

/** 단일 도메인 */
function createDomain() {
  return {
    host: 'textbook.com',
    origin: 'https://textbook.com',
    enabled: 1,
    description: '교과서 CDN',
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

/** 도메인 통계 */
function createDomainStats() {
  return {
    host: 'textbook.com',
    period: '24h',
    summary: {
      totalRequests: 1234,
      requestsDelta: 5.2,
      cacheHitRate: 0.85,
      cacheHitRateDelta: 2.1,
      bandwidth: 104857600,
      avgResponseTime: 42,
      responseTimeDelta: -3.5,
    },
    timeseries: {
      labels: ['00:00', '01:00', '02:00'],
      hits: [100, 120, 90],
      misses: [10, 15, 8],
      bandwidth: [1000, 1200, 900],
      responseTime: [40, 45, 38],
    },
  };
}

/** 도메인 요청 로그 */
function createDomainLogs() {
  return [
    { timestamp: 1700000000, status_code: 200, cache_status: 'HIT', path: '/image.jpg', size: 51200 },
    { timestamp: 1700000100, status_code: 404, cache_status: 'MISS', path: '/missing.png', size: 0 },
  ];
}

/** TLS 인증서 */
function createCertificates() {
  return [
    { domain: 'textbook.com', issued_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z' },
  ];
}

/** 인기 콘텐츠 */
function createPopularContent() {
  return [
    { url: 'https://textbook.com/img1.jpg', host: 'textbook.com', hits: 500, size: 102400 },
  ];
}

/** 최적화 절감 통계 */
function createOptimizationStats() {
  return {
    total_original_bytes: 1000000,
    total_optimized_bytes: 700000,
    total_savings_bytes: 300000,
    savings_percentage: 30,
    total_images_optimized: 150,
  };
}

/** 최적화 프로파일 */
function createOptimizerProfile() {
  return {
    profiles: [
      { domain: 'textbook.com', quality: 85, max_width: 0, enabled: true },
    ],
  };
}

/** 도메인 요약 통계 (도메인 목록 페이지용) */
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

/** 도메인 호스트 요약 — L1/엣지/Bypass 비율 포함 (Overview 카드용) */
function createDomainHostSummary() {
  return {
    host: 'textbook.com',
    today_requests: 100,
    today_cache_hits: 70,
    today_bandwidth: 0,
    hit_rate: 0.7,
    hourly: [],
    today_l1_hit_rate: 0.6,
    today_edge_hit_rate: 0.7,
    today_bypass_rate: 0.1,
    today_requests_delta: 0,
    today_hit_rate_delta: 0,
  };
}

// ─────────────────────────────────────────────
// 공통 mock 설정
// ─────────────────────────────────────────────

/** 도메인 상세 페이지에 필요한 전체 API mock을 등록한다 */
async function setupDetailMocks(page: Page) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
  await mockApi(page, 'GET', '/domains/textbook.com', createDomain());
  await mockApi(page, 'GET', '/domains/textbook.com/stats', createDomainStats());
  await mockApi(page, 'GET', '/domains/textbook.com/logs', createDomainLogs());
  await mockApi(page, 'GET', '/domains/textbook.com/summary', createDomainHostSummary());
  await mockApi(page, 'GET', '/tls/certificates', createCertificates());
  await mockApi(page, 'GET', '/cache/popular', createPopularContent());
  await mockApi(page, 'GET', '/stats/optimization', createOptimizationStats());
  await mockApi(page, 'GET', '/optimizer/profiles', createOptimizerProfile());
  // 버킷 합산 비율: l1=6, l2=1, miss=2, bypass=1, total=10 → L1=60%, Edge=70%, BYPASS=10%
  await page.route('**/api/cache/series*', (route) =>
    route.fulfill({
      json: { buckets: [{ ts: Date.now() - 60_000, l1_hits: 6, l2_hits: 1, miss: 2, bypass: 1 }] },
    }),
  );
}

// ─────────────────────────────────────────────
// Overview 탭 테스트
// ─────────────────────────────────────────────

test.describe('도메인 상세 — Overview 탭', () => {
  test('기본 정보 카드가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // host가 헤더에 표시되어야 한다
    await expect(page.getByRole('heading', { name: 'textbook.com' })).toBeVisible();
    // origin이 기본 정보 카드에 표시되어야 한다
    await expect(page.getByText('https://textbook.com')).toBeVisible();
  });

  test('TLS 상태 카드가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // TLS 관련 텍스트가 표시되어야 한다
    await expect(page.getByText('유효')).toBeVisible();
  });

  test('Quick Actions 4개 버튼이 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    const quickActions = page.getByTestId('domain-quick-actions');
    await expect(quickActions).toBeVisible();

    // 4개 액션 버튼이 모두 존재해야 한다
    await expect(page.getByTestId('proxy-test-open')).toBeVisible();
    await expect(page.getByTestId('purge-cache-open')).toBeVisible();
    await expect(page.getByTestId('tls-renew')).toBeVisible();
    await expect(page.getByTestId('force-sync')).toBeVisible();
  });

  test('캐시 퍼지 Quick Action이 동작한다', async ({ page }) => {
    await setupDetailMocks(page);
    await mockApi(page, 'POST', '/domains/textbook.com/purge', { ok: true });
    await page.goto('/domains/textbook.com');

    // 퍼지 버튼 클릭 → 확인 다이얼로그 표시
    await page.getByTestId('purge-cache-open').click();
    await expect(page.getByTestId('purge-confirm-dialog')).toBeVisible();

    // 확인 클릭 → 다이얼로그 닫힘
    await page.getByTestId('purge-confirm-submit').click();
    await expect(page.getByTestId('purge-confirm-dialog')).not.toBeVisible();
  });

  test('도메인 Overview — L1/엣지/BYPASS 비율 카드 3개가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // today_l1_hit_rate: 0.6 → "60.0%"
    await expect(page.getByTestId('domain-overview-l1-hit-rate')).toBeVisible();
    await expect(page.getByTestId('domain-overview-l1-hit-rate')).toHaveText('60.0%');
    // today_edge_hit_rate: 0.7 → "70.0%"
    await expect(page.getByTestId('domain-overview-edge-hit-rate')).toBeVisible();
    await expect(page.getByTestId('domain-overview-edge-hit-rate')).toHaveText('70.0%');
    // today_bypass_rate: 0.1 → "10.0%"
    await expect(page.getByTestId('domain-overview-bypass-rate')).toBeVisible();
    await expect(page.getByTestId('domain-overview-bypass-rate')).toHaveText('10.0%');
  });

  test('도메인 Overview — 스택 차트가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await expect(page.getByTestId('domain-overview-stacked-chart')).toBeVisible();
  });
});

// ─────────────────────────────────────────────
// 통계 탭 테스트
// ─────────────────────────────────────────────

test.describe('도메인 상세 — 통계 탭', () => {
  test('통계 탭으로 전환하면 차트가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 통계 탭 클릭
    await page.getByRole('tab', { name: '통계' }).click();

    // 통계 탭 컨텐츠가 표시되어야 한다
    await expect(page.getByTestId('domain-stats-tab')).toBeVisible();
  });

  test('인기 콘텐츠 테이블이 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '통계' }).click();
    await expect(page.getByTestId('domain-popular-content')).toBeVisible();
  });

  test('최적화 절감 통계 카드가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '통계' }).click();
    await expect(page.getByTestId('domain-optimization-stats')).toBeVisible();
  });
});

// ─────────────────────────────────────────────
// 설정 탭 테스트
// ─────────────────────────────────────────────

test.describe('도메인 상세 — 설정 탭', () => {
  test('Origin 편집이 동작한다', async ({ page }) => {
    await setupDetailMocks(page);
    await mockApi(page, 'PUT', '/domains/textbook.com', {
      ...createDomain(),
      origin: 'https://new-origin.com',
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭 전환
    await page.getByRole('tab', { name: '설정' }).click();
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // 편집 버튼 클릭 → origin 입력 → 저장
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('https://new-origin.com');
    await page.getByTestId('save-domain-btn').click();

    // 저장 후 편집 모드가 해제된다 (편집 버튼이 다시 보임)
    await expect(page.getByTestId('edit-domain-btn')).toBeVisible();
  });

  test('최적화 프로파일 편집이 동작한다', async ({ page }) => {
    await setupDetailMocks(page);
    await mockApi(page, 'PUT', '/optimizer/profiles/textbook.com', {});
    await page.goto('/domains/textbook.com');

    // 설정 탭 전환
    await page.getByRole('tab', { name: '설정' }).click();

    // quality 값 변경 → 저장
    const qualityInput = page.getByTestId('optimizer-quality-input');
    await qualityInput.fill('75');
    await page.getByTestId('optimizer-save-btn').click();

    // 저장 버튼이 비활성화되지 않고 유지되어야 한다 (뮤테이션 완료)
    await expect(page.getByTestId('optimizer-save-btn')).toBeEnabled();
  });

  test('도메인 삭제 시 목록으로 리다이렉트된다', async ({ page }) => {
    await setupDetailMocks(page);
    await mockApi(page, 'DELETE', '/domains/textbook.com', null);
    await mockApi(page, 'GET', '/domains', []);
    await page.goto('/domains/textbook.com');

    // 헤더의 삭제 버튼 클릭 → 확인 다이얼로그 표시
    await page.getByTestId('domain-delete-button').click();
    await expect(page.getByTestId('domain-delete-dialog')).toBeVisible();

    // 삭제 확인 클릭 → /domains로 리다이렉트
    await page.getByTestId('domain-delete-confirm').click();
    await expect(page).toHaveURL(/\/domains$/);
  });
});
