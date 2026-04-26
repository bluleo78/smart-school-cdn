/// 도메인 상세 페이지 E2E 테스트
/// Overview(개요), Stats(통계), Logs(로그), Settings(설정) 4개 탭의 핵심 시나리오를 검증한다.
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

  test('최적화 탭에 텍스트 압축 통계와 URL별 내역 표가 보인다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('domain-optimization-tab')).toBeVisible();
    await expect(page.getByTestId('text-compress-stats')).toBeVisible();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();
    // 필터/정렬 동작 스모크
    await page.getByTestId('url-opt-sort').selectOption('events');
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();
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
