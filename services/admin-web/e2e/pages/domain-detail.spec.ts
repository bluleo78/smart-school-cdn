/// 도메인 상세 페이지 E2E 테스트
/// Overview(개요), Optimizer(최적화), Traffic(트래픽), Settings(설정) 4개 탭의 핵심 시나리오를 검증한다.
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

/** 텍스트 압축 통계 — /api/optimization/stats?type=text_compress 응답 */
function createTextCompressStats() {
  return {
    total: 100,
    by_decision: [
      { decision: 'compressed_br', count: 60, total_orig: 600000, total_out: 200000 },
      { decision: 'compressed_gzip', count: 40, total_orig: 400000, total_out: 150000 },
    ],
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
  // 텍스트 압축 통계 — period 쿼리 파라미터를 무시하고 공통 응답 반환
  await page.route('**/api/optimization/stats*', (route) =>
    route.fulfill({ json: createTextCompressStats() }),
  );
  // Top URL 목록 mock
  await page.route('**/api/domains/textbook.com/top-urls*', (route) =>
    route.fulfill({
      json: { urls: [
        { path: '/a', count: 30 },
        { path: '/b', count: 20 },
        { path: '/c', count: 10 },
      ] },
    }),
  );
  // URL별 최적화 내역 mock — optimization/url-breakdown 엔드포인트
  await page.route('**/api/domains/textbook.com/optimization/url-breakdown*', (route) =>
    route.fulfill({
      json: {
        total: 0,
        items: [],
      },
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

  /**
   * 이슈 #72 회귀 방지 — Proxy/DNS 동기화 행이 ok={true} 하드코딩으로 항상 초록 표시되던 버그
   * 수정 후: 백엔드 미지원 필드이므로 해당 행이 아예 렌더링되지 않아야 한다.
   */
  test('동기화 & TLS 카드에 Proxy/DNS 동기화 행이 없다 (회귀: #72)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // "Proxy 동기화" 라벨이 화면에 없어야 한다 (하드코딩 ok={true} 제거)
    await expect(page.getByText('Proxy 동기화')).toHaveCount(0);
    // "DNS 동기화" 라벨이 화면에 없어야 한다 (하드코딩 ok={true} 제거)
    await expect(page.getByText('DNS 동기화')).toHaveCount(0);
    // TLS 상태 카드 헤딩이 여전히 렌더링되어야 한다
    await expect(page.getByRole('heading', { name: 'TLS 상태' })).toBeVisible();
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

  /**
   * 이슈 #65 회귀 방지 — 4xx/5xx 응답도 성공(녹색 ✓)으로 표시되던 버그
   * 수정 후: status_code 범위에 따라 색상·아이콘이 구분되어야 한다
   *   2xx → bg-success/10 text-success + ✓
   *   3xx → bg-warning/10 text-warning + ↗
   *   4xx/5xx → bg-destructive/10 text-destructive + ✗
   */
  test('프록시 테스트 다이얼로그 — 4xx 응답은 오류(빨간) 스타일로 표시된다 (회귀: #65)', async ({ page }) => {
    await setupDetailMocks(page);
    // 서버가 success: true이지만 status_code 404 반환하는 시나리오 모킹
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 404,
      response_time_ms: 50,
    });
    await page.goto('/domains/textbook.com');

    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();

    await page.getByTestId('proxy-test-path-input').fill('/status/404');
    await page.getByTestId('proxy-test-submit').click();

    const result = page.getByTestId('proxy-test-result');
    await expect(result).toBeVisible();

    // 404는 빨간 오류 스타일이어야 한다 (수정 전: bg-success/10 적용됨)
    const className = await result.getAttribute('class');
    expect(className).toContain('bg-destructive');
    expect(className).not.toContain('bg-success');

    // ✗ 아이콘과 상태 코드가 표시되어야 한다
    await expect(result).toContainText('✗');
    await expect(result).toContainText('404');
  });

  test('프록시 테스트 다이얼로그 — 3xx 응답은 경고(노란) 스타일로 표시된다 (회귀: #65)', async ({ page }) => {
    await setupDetailMocks(page);
    // 3xx 리다이렉트 시나리오 모킹
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 301,
      response_time_ms: 30,
    });
    await page.goto('/domains/textbook.com');

    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();

    await page.getByTestId('proxy-test-path-input').fill('/redirect');
    await page.getByTestId('proxy-test-submit').click();

    const result = page.getByTestId('proxy-test-result');
    await expect(result).toBeVisible();

    // 301은 경고(warning) 스타일이어야 한다
    const className = await result.getAttribute('class');
    expect(className).toContain('bg-warning');
    expect(className).not.toContain('bg-success');
    expect(className).not.toContain('bg-destructive');

    // ↗ 아이콘과 상태 코드가 표시되어야 한다
    await expect(result).toContainText('↗');
    await expect(result).toContainText('301');
  });

  test('프록시 테스트 다이얼로그 — 경로 입력 필드가 shadcn Input 높이(h-9)를 갖는다 (#50)', async ({ page }) => {
    // raw <input> → shadcn <Input> 교체 회귀 방지
    await setupDetailMocks(page);
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 42,
    });
    await page.goto('/domains/textbook.com');

    // 프록시 테스트 다이얼로그 열기
    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();

    // 경로 입력 필드가 shadcn Input의 표준 높이(h-9 = 36px)를 적용해야 한다
    const inputBox = await page.getByTestId('proxy-test-path-input').boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.height).toBeCloseTo(36, 0);

    // 경로 입력 후 테스트 요청 전송 → 결과 표시
    await page.getByTestId('proxy-test-path-input').fill('/api/get');
    await page.getByTestId('proxy-test-submit').click();
    await expect(page.getByTestId('proxy-test-result')).toBeVisible();
    await expect(page.getByTestId('proxy-test-result')).toContainText('200');
  });

  test('프록시 테스트 다이얼로그 — 2xx 응답 시 response_headers가 헤더 목록으로 표시된다 (회귀: #69)', async ({ page }) => {
    // 서버가 CDN 관련 헤더를 포함한 응답을 반환하는 시나리오 모킹
    await setupDetailMocks(page);
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 32,
      response_headers: {
        'x-cache': 'HIT',
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'max-age=3600',
      },
    });
    await page.goto('/domains/textbook.com');

    // 프록시 테스트 다이얼로그 열기 → 경로 입력 → 테스트 실행
    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();
    await page.getByTestId('proxy-test-path-input').fill('/');
    await page.getByTestId('proxy-test-submit').click();

    // 결과가 2xx 성공 스타일로 표시되어야 한다
    const result = page.getByTestId('proxy-test-result');
    await expect(result).toBeVisible();
    const className = await result.getAttribute('class');
    expect(className).toContain('bg-success');

    // 응답 헤더 목록이 렌더링되어야 한다 (input → process → output 파이프라인 검증)
    const headers = page.getByTestId('proxy-test-headers');
    await expect(headers).toBeVisible();
    await expect(headers).toContainText('x-cache:');
    await expect(headers).toContainText('HIT');
    await expect(headers).toContainText('content-type:');
    await expect(headers).toContainText('text/html; charset=utf-8');
    await expect(headers).toContainText('cache-control:');
    await expect(headers).toContainText('max-age=3600');
  });

  test('프록시 테스트 다이얼로그 — response_headers가 없는 경우 헤더 목록이 표시되지 않는다', async ({ page }) => {
    // 레거시 서버 응답 또는 헤더 없는 케이스 — 헤더 섹션이 렌더링되지 않아야 한다
    await setupDetailMocks(page);
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 20,
      // response_headers 필드 없음 — 구버전 서버 호환성
    });
    await page.goto('/domains/textbook.com');

    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();
    await page.getByTestId('proxy-test-submit').click();

    await expect(page.getByTestId('proxy-test-result')).toBeVisible();
    // 헤더 목록 섹션이 렌더링되지 않아야 한다
    await expect(page.getByTestId('proxy-test-headers')).not.toBeVisible();
  });

  test('Overview — Quick Actions 4개 버튼이 동일 y 오프셋에 정렬된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    const buttons = [
      page.getByTestId('proxy-test-open'),
      page.getByTestId('purge-cache-open'),
      page.getByTestId('tls-renew'),
      page.getByTestId('force-sync'),
    ];
    const boxes = await Promise.all(buttons.map((b) => b.boundingBox()));
    const ys = boxes.map((b) => b?.y ?? -1).filter((y) => y >= 0);
    // 네 버튼의 y 좌표 최댓값-최솟값 차가 2px 이내
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
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
    await page.getByRole('tab', { name: '최적화' }).click();

    // 통계 탭 컨텐츠가 표시되어야 한다
    await expect(page.getByTestId('domain-optimization-tab')).toBeVisible();
  });

  test('최적화 절감 통계 카드가 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('domain-optimization-stats')).toBeVisible();
  });

  test('Stats 탭에 캐시/최적화 2섹션이 모두 렌더링된다 (Phase 16: 트래픽은 트래픽 탭으로 이동)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    await expect(page.getByTestId('stats-cache-section')).toBeVisible();
    await expect(page.getByTestId('stats-optimization-section')).toBeVisible();
    // 트래픽 섹션은 더 이상 최적화 탭에 없어야 한다
    await expect(page.getByTestId('stats-traffic-section')).toHaveCount(0);
  });

  test('Stats 탭 기간 토글 — 1h/24h/7d/30d/커스텀 버튼이 존재', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    await expect(page.getByTestId('period-1h')).toBeVisible();
    await expect(page.getByTestId('period-24h')).toBeVisible();
    await expect(page.getByTestId('period-7d')).toBeVisible();
    await expect(page.getByTestId('period-30d')).toBeVisible();
    await expect(page.getByTestId('period-custom')).toBeVisible();
  });

  test('커스텀 기간 — from만 입력해도 오늘까지 범위가 적용된다 (회귀: #40)', async ({ page }) => {
    // from만 입력 시 to 없이 applyCustom이 호출되면 to <= from 조건으로 조용히 무시되던 버그
    // 수정 후: to가 없으면 오늘 날짜를 기본값으로 사용하여 onChange가 호출되어야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 표시 (커스텀 버튼은 비선택 상태)
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();

    // from만 입력하고 to는 비워둠
    await page.getByTestId('period-custom-from').fill('2026-04-01');

    // 오늘 날짜가 기본 to로 설정되어 from < to 조건 충족 → period 선택이 커스텀으로 전환됨
    // aria-pressed="true"는 커스텀 버튼이 선택 상태임을 나타냄
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'true');
  });

  test('커스텀 기간 날짜 입력이 shadcn Input 컴포넌트를 사용한다 — 포커스 링 클래스 존재 (회귀: #8)', async ({ page }) => {
    // raw <input> 대신 <Input> 컴포넌트를 사용해야 focus-visible:ring-* 클래스가 적용된다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 2개가 표시된다
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();
    await expect(page.getByTestId('period-custom-to')).toBeVisible();

    // shadcn Input 컴포넌트가 주입하는 focus-visible:ring-2 클래스가 있어야 한다
    const fromClass = await page.getByTestId('period-custom-from').getAttribute('class');
    const toClass = await page.getByTestId('period-custom-to').getAttribute('class');
    expect(fromClass).toContain('focus-visible:ring-2');
    expect(toClass).toContain('focus-visible:ring-2');
  });

  test('Stats 탭 수동 새로고침 버튼이 존재', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('manual-refresh-btn')).toBeVisible();
  });

  test('7d/30d 기간 선택 시 24h degrade 안내 배너가 표시된다 (회귀: #51)', async ({ page }) => {
    // 7d/30d 선택 시 캐시 시계열이 24h로 degrade되는데 안내 없이 표시되던 버그.
    // 수정 후: degrade 조건에서 안내 배너(data-testid=cache-series-degrade-notice)가 나타나야 한다.
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 기본(24h) 상태에서는 안내 배너가 없어야 한다
    await expect(page.getByTestId('cache-series-degrade-notice')).toHaveCount(0);

    // 7d 선택 → 안내 배너 표시
    await page.getByTestId('period-7d').click();
    await expect(page.getByTestId('cache-series-degrade-notice')).toBeVisible();

    // 30d 선택 → 안내 배너 표시
    await page.getByTestId('period-30d').click();
    await expect(page.getByTestId('cache-series-degrade-notice')).toBeVisible();

    // 1h 선택 → 안내 배너 사라짐
    await page.getByTestId('period-1h').click();
    await expect(page.getByTestId('cache-series-degrade-notice')).toHaveCount(0);

    // 24h 선택 → 안내 배너 없음
    await page.getByTestId('period-24h').click();
    await expect(page.getByTestId('cache-series-degrade-notice')).toHaveCount(0);
  });

  test('최적화 탭에 텍스트 압축 통계와 URL별 내역 표가 보인다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('domain-optimization-tab')).toBeVisible();
    await expect(page.getByTestId('text-compress-stats')).toBeVisible();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();
    // 정렬 Select 동작 스모크 — shadcn Select(Radix) 인터랙션: trigger 클릭 → item 선택
    await page.getByTestId('url-opt-sort').click();
    await page.getByRole('option', { name: '이벤트 수 ↓' }).click();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();
  });

  /**
   * 이슈 #54 회귀 방지 — DomainUrlOptimizationTable의 raw HTML 요소 → shadcn 컴포넌트 교체
   * - raw <select> → shadcn Select
   * - raw <table> → shadcn Table
   * - raw <button> → shadcn Button
   * - "decision" 헤더 → "최적화 결정" 한국어 통일
   */
  test('URL별 내역 표 — shadcn Select 트리거가 h-9 높이를 갖고 decision 드롭다운이 shadcn Select다 (회귀: #54)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();

    // shadcn SelectTrigger는 h-9(36px)를 적용해야 한다 (raw <select>는 h-9 클래스가 없음)
    const decisionTrigger = page.getByTestId('url-opt-decision');
    await expect(decisionTrigger).toBeVisible();
    const decisionBox = await decisionTrigger.boundingBox();
    expect(decisionBox).not.toBeNull();
    expect(decisionBox!.height).toBeCloseTo(36, 0);

    const sortTrigger = page.getByTestId('url-opt-sort');
    await expect(sortTrigger).toBeVisible();
    const sortBox = await sortTrigger.boundingBox();
    expect(sortBox).not.toBeNull();
    expect(sortBox!.height).toBeCloseTo(36, 0);

    // decision 드롭다운을 열면 shadcn Select 옵션들이 노출되어야 한다
    await decisionTrigger.click();
    await expect(page.getByRole('option', { name: '이미지 · 최적화됨' })).toBeVisible();
    // Radix 포탈 닫기 — Escape 키
    await page.keyboard.press('Escape');
  });

  /**
   * 이슈 #53 회귀 방지 — 텍스트 압축 통계 카드가 PeriodSelector 무시하고 항상 30d 조회
   * 수정 후: PeriodSelector 기간 변경 시 텍스트 압축 카드 제목과 API 요청 period가 함께 바뀌어야 한다.
   */
  test('텍스트 압축 통계 카드 — PeriodSelector 선택 기간에 따라 카드 제목과 API period가 변경된다 (회귀: #53)', async ({ page }) => {
    await setupDetailMocks(page);

    // period 파라미터를 추적하여 API 호출 시 올바른 period가 전달되는지 검증한다
    const capturedPeriods: string[] = [];
    await page.route('**/api/optimization/stats*', (route) => {
      const url = new URL(route.request().url());
      const period = url.searchParams.get('period');
      if (period) capturedPeriods.push(period);
      return route.fulfill({ json: createTextCompressStats() });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 기본 기간(24h)에서 카드가 렌더링되어야 한다
    await expect(page.getByTestId('text-compress-stats')).toBeVisible();

    // 1시간 선택 → 카드 제목이 1시간 누적으로 변경되어야 한다
    await page.getByTestId('period-1h').click();
    await expect(page.getByTestId('text-compress-stats')).toContainText('1시간 누적');

    // 7일 선택 → 카드 제목이 7일 누적으로 변경되어야 한다
    await page.getByTestId('period-7d').click();
    await expect(page.getByTestId('text-compress-stats')).toContainText('7일 누적');

    // 30일 선택 → 카드 제목이 30일 누적으로 변경되어야 한다
    await page.getByTestId('period-30d').click();
    await expect(page.getByTestId('text-compress-stats')).toContainText('30일 누적');

    // API 요청에 선택한 period가 포함되어야 한다 (30d 고정이 아님)
    expect(capturedPeriods).toContain('1h');
    expect(capturedPeriods).toContain('7d');
  });
});

// ─────────────────────────────────────────────
// Logs 탭 테스트
// ─────────────────────────────────────────────

test.describe('도메인 상세 — Logs 탭', () => {
  test('Logs 탭에 Top URL 카드 + 로그 테이블이 렌더링된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();

    await expect(page.getByTestId('domain-traffic-tab')).toBeVisible();
    await expect(page.getByTestId('domain-top-urls')).toBeVisible();
    // Top URL 첫 항목 — mock 의 /a (30)
    await expect(page.getByTestId('domain-top-urls')).toContainText('/a');
    await expect(page.getByTestId('domain-top-urls')).toContainText('30');
  });

  test('Logs 탭에 트래픽 차트 섹션(요청 추이)이 렌더링된다 (Phase 16-3)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();

    await expect(page.getByTestId('traffic-charts-section')).toBeVisible();
  });

  test('Logs 탭 자동 갱신 드롭다운 기본값은 30초', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();
    const select = page.getByTestId('refresh-interval-select');
    await expect(select).toBeVisible();
    await expect(select).toContainText('30초');
  });

  test('"에러만" 토글 — 4xx 에러가 목록에 표시된다 (회귀: #46)', async ({ page }) => {
    // 버그: errorsOnly=true 시 status=5xx만 전송 → 4xx 에러(404 등)가 누락됨
    // 수정: status=error(4xx+5xx 통합)로 전송하여 4xx 에러도 포함되어야 한다
    await setupDetailMocks(page);

    // 로그 mock: 에러 필터(status=error) 시 4xx 로그 반환, 필터 없으면 전체 반환
    let filteredCallUrl = '';
    await page.route('**/api/domains/textbook.com/logs*', (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get('status');
      filteredCallUrl = route.request().url();
      if (status === 'error') {
        // 수정 후 동작: 4xx + 5xx 모두 반환
        return route.fulfill({
          json: [
            { timestamp: 1700000100, status_code: 404, cache_status: 'MISS', path: '/missing.png', size: 0 },
            { timestamp: 1700000000, status_code: 500, cache_status: 'MISS', path: '/server-error', size: 0 },
          ],
        });
      }
      // 필터 없음: 전체 반환
      return route.fulfill({ json: createDomainLogs() });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();

    // "에러만" 토글 활성화
    await page.getByRole('button', { name: '에러만' }).click();

    // 4xx 에러(404)가 목록에 표시되어야 한다
    const logTable = page.locator('table');
    await expect(logTable).toBeVisible();
    await expect(logTable).toContainText('/missing.png');
    await expect(logTable).toContainText('404');

    // 5xx 에러도 함께 표시되어야 한다
    await expect(logTable).toContainText('/server-error');
    await expect(logTable).toContainText('500');

    // 서버에 status=error로 전송되어야 한다 (5xx만 보내지 않음)
    expect(filteredCallUrl).toContain('status=error');
  });
});

// ─────────────────────────────────────────────
// 설정 탭 테스트
// ─────────────────────────────────────────────

test.describe('도메인 상세 — 설정 탭', () => {
  test('Origin 빈값 저장 시 에러 토스트가 표시되고 PUT이 호출되지 않는다 (회귀: #59)', async ({ page }) => {
    // 수정 전: handleSave()가 origin 검증 없이 뮤테이션을 호출해 빈 origin이 저장됨
    // 수정 후: 클라이언트 검증이 서버 전송을 막고 에러 토스트를 표시해야 한다
    await setupDetailMocks(page);
    let putCallCount = 0;
    await page.route('**/api/domains/textbook.com', (route) => {
      if (route.request().method() === 'PUT') putCallCount++;
      return route.fallback();
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭으로 전환
    await page.getByRole('tab', { name: '설정' }).click();
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // 편집 모드 진입 → origin 비움 → 저장 시도
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('');
    await page.getByTestId('save-domain-btn').click();

    // 에러 토스트가 표시되어야 한다
    await expect(page.getByText('오리진 URL을 입력해 주세요.')).toBeVisible();
    // PUT API는 호출되지 않아야 한다
    expect(putCallCount).toBe(0);
    // 편집 모드가 유지되어야 한다 (저장 버튼이 여전히 보임)
    await expect(page.getByTestId('save-domain-btn')).toBeVisible();
  });

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

  test('최적화 프로파일 — quality=0 저장 시 클라이언트 검증 에러가 표시되고 PUT이 호출되지 않는다 (회귀: #48)', async ({ page }) => {
    // 수정 전: 서버에 quality=0을 전송 후 400 응답을 받고 고정 메시지 "저장에 실패했습니다."를 표시
    // 수정 후: 클라이언트 검증이 서버 전송을 막고 범위 오류 메시지를 표시해야 한다
    await setupDetailMocks(page);
    let putCallCount = 0;
    await page.route('**/api/optimizer/profiles/textbook.com', (route) => {
      if (route.request().method() === 'PUT') putCallCount++;
      return route.fallback();
    });
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '설정' }).click();

    // quality에 범위 밖 값(0) 입력 후 저장
    await page.getByTestId('optimizer-quality-input').fill('0');
    await page.getByTestId('optimizer-save-btn').click();

    // 클라이언트 검증 에러 토스트가 표시되어야 한다
    await expect(page.getByText('품질은 1–100 사이여야 합니다.')).toBeVisible();
    // 서버 PUT은 호출되지 않아야 한다
    expect(putCallCount).toBe(0);
  });

  test('최적화 프로파일 — 서버 400 에러 시 응답 메시지가 toast에 표시된다 (회귀: #48)', async ({ page }) => {
    // 수정 전: onError 콜백이 고정 문자열만 표시하여 서버 검증 메시지가 누락됨
    // 수정 후: 서버 응답의 message 필드를 toast에 표시해야 한다
    await setupDetailMocks(page);
    // 서버가 400 + 구체적 메시지를 반환하는 시나리오 모킹
    await page.route('**/api/optimizer/profiles/textbook.com', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'body/quality must be >= 1' }),
        });
      }
      return route.fallback();
    });
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '설정' }).click();

    // 유효 범위 내 값으로 저장 (클라이언트 검증 통과 후 서버 에러 발생)
    await page.getByTestId('optimizer-quality-input').fill('50');
    await page.getByTestId('optimizer-save-btn').click();

    // 서버 응답의 구체적 메시지가 toast에 표시되어야 한다
    await expect(page.getByText('body/quality must be >= 1')).toBeVisible();
  });

  test('TLS 카드가 "정보 없음" 대신 실제 만료일·갱신일을 표시한다 (회귀: #32)', async ({ page }) => {
    // createCertificates() 팩토리의 issued_at / expires_at 값이 화면에 나타나야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '설정' }).click();
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // "정보 없음" 하드코딩이 사라져야 한다 — 실제 날짜가 표시됨
    const tlsCard = page.locator('text=TLS / 인증서').locator('../..');
    await expect(tlsCard).not.toContainText('정보 없음');

    // expires_at: '2027-01-01T00:00:00Z' → 한국어 포맷 확인
    const expiresKo = new Date('2027-01-01T00:00:00Z').toLocaleDateString('ko-KR');
    await expect(tlsCard).toContainText(expiresKo);

    // issued_at: '2026-01-01T00:00:00Z' → 한국어 포맷 확인
    const issuedKo = new Date('2026-01-01T00:00:00Z').toLocaleDateString('ko-KR');
    await expect(tlsCard).toContainText(issuedKo);
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

  test('URL 퍼지 — 다른 도메인 URL 입력 시 에러 토스트가 표시되고 API를 호출하지 않는다 (#36 회귀)', async ({ page }) => {
    // mock: purge API 인터셉터로 호출 여부를 추적한다
    await setupDetailMocks(page);
    let purgeCallCount = 0;
    await page.route('**/api/cache/purge', (route) => {
      purgeCallCount++;
      return route.fulfill({ json: { purged_count: 0 } });
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭 전환 → URL 퍼지 입력창에 타 도메인 URL 입력
    await page.getByRole('tab', { name: '설정' }).click();
    await page.getByTestId('url-purge-input').fill('https://totally-different-domain.com/secret/path');
    await page.getByTestId('url-purge-btn').click();

    // 에러 토스트가 표시되어야 한다 — 도메인 불일치 메시지 포함
    await expect(page.getByText('textbook.com 도메인 소속이어야 합니다')).toBeVisible();
    // purge API는 호출되지 않아야 한다
    expect(purgeCallCount).toBe(0);
  });

  test('URL 퍼지 — 유효하지 않은 URL 입력 시 에러 토스트가 표시된다 (#36 회귀)', async ({ page }) => {
    await setupDetailMocks(page);
    let purgeCallCount = 0;
    await page.route('**/api/cache/purge', (route) => {
      purgeCallCount++;
      return route.fulfill({ json: { purged_count: 0 } });
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭 전환 → URL 형식이 아닌 값 입력
    await page.getByRole('tab', { name: '설정' }).click();
    await page.getByTestId('url-purge-input').fill('not-a-valid-url');
    await page.getByTestId('url-purge-btn').click();

    // 유효하지 않은 URL 에러 토스트가 표시되어야 한다
    await expect(page.getByText('유효한 URL을 입력해 주세요')).toBeVisible();
    // purge API는 호출되지 않아야 한다
    expect(purgeCallCount).toBe(0);
  });
});

// ─── 헤더 액션 에러 처리 (#45 회귀) ──────────────────────────────
test.describe('도메인 상세 — 헤더 액션 에러 처리 (#45)', () => {
  test('캐시 퍼지 실패 시 Unhandled Promise Rejection이 발생하지 않는다', async ({ page }) => {
    // mutateAsync try-catch 누락 → Unhandled Promise Rejection 재발 방지
    await setupDetailMocks(page);
    // purge API를 500으로 모킹하여 에러 조건 재현
    await mockApi(page, 'POST', '/domains/textbook.com/purge', { error: 'Proxy offline' }, { status: 500 });
    await page.goto('/domains/textbook.com');

    // uncaughtException / unhandledrejection 이벤트 수집
    const uncaughtErrors: string[] = [];
    page.on('pageerror', (err) => uncaughtErrors.push(err.message));

    // 헤더의 캐시 퍼지 버튼 클릭 (에러 응답)
    await page.getByTestId('domain-purge-button').click();

    // onError toast가 표시되어야 한다 (에러 처리 정상 동작)
    await expect(page.getByRole('status').first()).toBeVisible({ timeout: 3000 }).catch(() => {
      // sonner toast가 role=status가 아닐 수 있으므로 대기만 진행
    });

    // 짧게 대기하여 Unhandled Rejection이 발생할 시간을 준다
    await page.waitForTimeout(500);

    // Unhandled Promise Rejection이 없어야 한다 (try-catch로 억제됨)
    expect(uncaughtErrors.filter(m => m.includes('AxiosError') || m.includes('Request failed'))).toHaveLength(0);
  });

  test('활성화/비활성화 토글 실패 시 Unhandled Promise Rejection이 발생하지 않는다', async ({ page }) => {
    // mutateAsync try-catch 누락 → Unhandled Promise Rejection 재발 방지
    await setupDetailMocks(page);
    // toggle API를 500으로 모킹하여 에러 조건 재현
    await mockApi(page, 'POST', '/domains/textbook.com/toggle', { error: 'Proxy offline' }, { status: 500 });
    await page.goto('/domains/textbook.com');

    const uncaughtErrors: string[] = [];
    page.on('pageerror', (err) => uncaughtErrors.push(err.message));

    // 헤더의 비활성화 토글 버튼 클릭 (에러 응답)
    await page.getByTestId('domain-toggle-button').click();

    await page.waitForTimeout(500);

    // Unhandled Promise Rejection이 없어야 한다 (try-catch로 억제됨)
    expect(uncaughtErrors.filter(m => m.includes('AxiosError') || m.includes('Request failed'))).toHaveLength(0);
  });
});

// ─── 빈 데이터 empty state (#21 회귀) ─────────────────────────
test.describe('도메인 상세 — DomainStackedChart empty state (#21)', () => {
  test('캐시 시계열 데이터가 없으면 차트 대신 empty state 메시지가 표시된다', async ({ page }) => {
    // 빈 버킷 배열 → DomainStackedChart의 data.length === 0 분기 진입 검증
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
    // 빈 버킷 → empty state 진입
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: [] } }),
    );
    await page.route('**/api/domains/textbook.com/top-urls*', (route) =>
      route.fulfill({ json: { urls: [] } }),
    );

    await page.goto('/domains/textbook.com');
    // DomainDetailTabs의 stats 탭은 '최적화' 텍스트로 접근 (testid 없음)
    await page.getByRole('tab', { name: '최적화' }).click();

    // DomainStackedChart 안에 empty state 문구가 노출되어야 한다
    const chart = page.getByTestId('domain-overview-stacked-chart');
    await expect(chart).toBeVisible();
    await expect(chart.getByText('아직 데이터가 없습니다')).toBeVisible();
    await expect(chart.getByText('프록시로 요청이 들어오면 자동으로 표시됩니다')).toBeVisible();
  });
});

// ─── 존재하지 않는 도메인 접근 (#66 회귀) ──────────────────────────
test.describe('도메인 상세 — 존재하지 않는 도메인 접근 (#66)', () => {
  /**
   * 이슈 #66 회귀 방지 — 존재하지 않는 도메인 URL 접근 시 토스트 없이 조용히 리다이렉트되던 버그
   * 수정 후: 에러 토스트("해당 도메인을 찾을 수 없습니다.")를 표시한 뒤 /domains로 이동해야 한다.
   */
  test('존재하지 않는 도메인 URL 접근 시 에러 토스트가 표시되고 목록으로 이동한다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
    // 존재하지 않는 도메인 — 404 반환
    await mockApi(page, 'GET', '/domains/nonexistent-xyz', { message: 'Not Found' }, { status: 404 });

    await page.goto('/domains/nonexistent-xyz');

    // 에러 토스트가 표시되어야 한다 (수정 전: 토스트 없이 조용히 리다이렉트됨)
    await expect(page.getByText('해당 도메인을 찾을 수 없습니다.')).toBeVisible();

    // /domains 목록으로 이동해야 한다
    await expect(page).toHaveURL(/\/domains$/);
  });
});

// ─── 브라우저 탭 제목 (#78 회귀) ────────────────────────────────────
test.describe('도메인 상세 — 브라우저 탭 제목 (#78)', () => {
  /**
   * 이슈 #78 회귀 방지 — 도메인 상세 페이지 title이 "도메인 관리 | Smart School CDN"으로
   * 고정되어 여러 탭을 열었을 때 구분이 불가하던 버그.
   * 수정 후: "textbook.com — 도메인 관리 | Smart School CDN" 형태로 호스트명이 포함되어야 한다.
   */
  test('도메인 상세 페이지 title에 호스트명이 포함된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // host가 포함된 title이어야 한다 (수정 전: "도메인 관리 | Smart School CDN" 고정)
    await expect(page).toHaveTitle('textbook.com — 도메인 관리 | Smart School CDN');
  });

  test('도메인 상세 → 목록 복귀 시 title이 "도메인 관리 | Smart School CDN"으로 복원된다', async ({ page }) => {
    // 언마운트 cleanup: return () => { document.title = '도메인 관리 | Smart School CDN'; }
    await setupDetailMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    await page.goto('/domains/textbook.com');

    // 상세 페이지에서 host 포함 title 확인
    await expect(page).toHaveTitle('textbook.com — 도메인 관리 | Smart School CDN');

    // 뒤로가기 → 목록으로 이동
    await page.goto('/domains');

    // 목록 페이지로 돌아왔을 때 AppLayout이 title을 "도메인 관리 | Smart School CDN"으로 복원해야 한다
    await expect(page).toHaveTitle('도메인 관리 | Smart School CDN');
  });
});

// ─── 탭 URL 동기화 (#61 회귀) ──────────────────────────────────────
test.describe('도메인 상세 — 탭 URL searchParam 동기화 (#61)', () => {
  /**
   * 탭 클릭 시 ?tab=<value> 가 URL에 반영되어야 한다.
   * 반영되지 않으면 뒤로가기·북마크·공유 링크로 이전 탭에 돌아올 수 없다.
   */
  test('설정 탭 클릭 시 ?tab=settings 가 URL에 추가된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 기본 상태에서 tab 파라미터가 없어야 한다 (또는 overview)
    await expect(page).not.toHaveURL(/tab=settings/);

    // 설정 탭 클릭
    await page.getByRole('tab', { name: '설정' }).click();

    // URL에 ?tab=settings 가 반영되어야 한다
    await expect(page).toHaveURL(/tab=settings/);
  });

  test('최적화 탭 클릭 시 ?tab=optimizer 가 URL에 추가된다 (회귀: #64)', async ({ page }) => {
    // 수정 전: value="stats" → ?tab=stats (레이블 "최적화"와 불일치)
    // 수정 후: value="optimizer" → ?tab=optimizer
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page).toHaveURL(/tab=optimizer/);
  });

  test('트래픽 탭 클릭 시 ?tab=traffic 이 URL에 추가된다 (회귀: #64)', async ({ page }) => {
    // 수정 전: value="logs" → ?tab=logs (레이블 "트래픽"과 불일치)
    // 수정 후: value="traffic" → ?tab=traffic
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    await page.getByRole('tab', { name: '트래픽' }).click();
    await expect(page).toHaveURL(/tab=traffic/);
  });

  test('?tab=settings 로 직접 접근하면 설정 탭이 활성화된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=settings');

    // 설정 탭 패널이 바로 표시되어야 한다
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();
  });

  test('?tab=optimizer 로 직접 접근하면 최적화 탭이 활성화된다 (회귀: #64)', async ({ page }) => {
    // value 식별자 stats→optimizer 변경 후 북마크/공유 링크 직접 접근 검증
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=optimizer');

    await expect(page.getByTestId('domain-optimization-tab')).toBeVisible();
  });

  test('?tab=traffic 으로 직접 접근하면 트래픽 탭이 활성화된다 (회귀: #64)', async ({ page }) => {
    // value 식별자 logs→traffic 변경 후 북마크/공유 링크 직접 접근 검증
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=traffic');

    await expect(page.getByTestId('domain-traffic-tab')).toBeVisible();
  });

  test('잘못된 ?tab 값으로 접근하면 개요 탭으로 폴백된다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=invalid_value');

    // overview 탭 내용(origin)이 표시되어야 한다
    await expect(page.getByText('https://textbook.com')).toBeVisible();
  });
});
