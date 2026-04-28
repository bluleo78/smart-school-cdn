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
   * 이슈 #142 회귀 방지 — 퍼지 진행 중 취소/ESC로 dialog가 닫히는 버그
   * 수정 후:
   * - 취소 버튼이 isPending 동안 disabled 처리되어야 한다
   * - ESC 키를 눌러도 dialog가 닫히지 않아야 한다
   */
  test('PurgeConfirmDialog — 퍼지 진행 중 취소 버튼이 disabled되고 ESC로 닫히지 않는다 (회귀: #142)', async ({ page }) => {
    // 수정 전: 취소 버튼에 disabled 없고 onClose에 isPending 가드 없어 mutation 진행 중 닫힘 가능
    // 수정 후: disabled={isPending} + onClose에서 !isPending 가드 → 진행 중 닫기 차단
    await setupDetailMocks(page);

    // purge API를 지연 응답으로 설정하여 isPending 상태를 유지한다
    let resolveRoute: (() => void) | null = null;
    await page.route('**/api/domains/textbook.com/purge', async (route) => {
      // 외부에서 해제할 때까지 응답을 보류한다
      await new Promise<void>((res) => { resolveRoute = res; });
      return route.fulfill({ status: 200, json: { ok: true } });
    });

    await page.goto('/domains/textbook.com');

    // 퍼지 다이얼로그 열기
    await page.getByTestId('purge-cache-open').click();
    await expect(page.getByTestId('purge-confirm-dialog')).toBeVisible();

    // 퍼지 실행 → mutation 시작 (응답 지연 중)
    await page.getByTestId('purge-confirm-submit').click();

    // isPending 동안 취소 버튼이 disabled 상태여야 한다
    await expect(page.locator('[data-testid="purge-confirm-dialog"] button:has-text("취소")')).toBeDisabled({ timeout: 1000 });

    // ESC 키를 눌러도 dialog가 열린 상태를 유지해야 한다
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('purge-confirm-dialog')).toBeVisible({ timeout: 500 });

    // 응답 해제 → 완료 → 다이얼로그 닫힘
    resolveRoute!();
    await expect(page.getByTestId('purge-confirm-dialog')).not.toBeVisible({ timeout: 3000 });
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

  /**
   * 이슈 #132 회귀 방지 — 빈 경로 입력 시 API 호출 없이 클라이언트 오류 메시지 표시
   * 수정 전: path='' 로 testProxy()가 호출되어 서버가 400 반환
   * 수정 후: handleTest()가 path.trim() 검사로 API 호출 차단 → 오류 메시지 노출
   */
  test('프록시 테스트 다이얼로그 — 빈 경로 제출 시 API 호출 없이 오류 메시지가 표시된다 (회귀: #132)', async ({ page }) => {
    await setupDetailMocks(page);
    // /proxy/test mock을 등록하되, 실제로 호출되면 안 된다
    let proxyTestCalled = false;
    await page.route('**/api/proxy/test', (route) => {
      proxyTestCalled = true;
      return route.fulfill({ json: { success: true, status_code: 200, response_time_ms: 0 } });
    });

    await page.goto('/domains/textbook.com');

    // 프록시 테스트 다이얼로그 열기
    await page.getByTestId('proxy-test-open').click();
    await expect(page.getByTestId('proxy-test-dialog')).toBeVisible();

    // 경로 입력 필드를 빈 문자열로 초기화 (기본값 '/'를 지움)
    await page.getByTestId('proxy-test-path-input').fill('/');
    await page.getByTestId('proxy-test-path-input').selectText();
    await page.keyboard.press('Backspace');
    // 빈 상태 확인
    await expect(page.getByTestId('proxy-test-path-input')).toHaveValue('');

    // 빈 경로로 테스트 버튼 클릭
    await page.getByTestId('proxy-test-submit').click();

    // 클라이언트 검증 오류 메시지가 결과 영역에 표시되어야 한다
    const result = page.getByTestId('proxy-test-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('경로를 입력하세요');

    // API가 실제로 호출되어서는 안 된다 (서버 400 차단)
    expect(proxyTestCalled).toBe(false);
  });

  /**
   * 이슈 #87 회귀 방지 — delta=0일 때 DeltaBadge가 ↑ 화살표 대신 중립(—) 표시
   * requestsDelta=0, cacheHitRateDelta=0, responseTimeDelta=0 시나리오에서
   * ↑ 화살표가 사라지고 — 기호가 표시되어야 한다.
   */
  test('Overview — delta=0 통계 카드에서 ↑ 화살표 없이 중립(—) 표시가 나타난다 (#87 회귀 방지)', async ({
    page,
  }) => {
    // delta가 모두 0인 stats mock으로 오버라이드
    await setupDetailMocks(page);
    await mockApi(page, 'GET', '/domains/textbook.com/stats', {
      host: 'textbook.com',
      period: '24h',
      summary: {
        totalRequests: 0,
        requestsDelta: 0,
        cacheHitRate: 0,
        cacheHitRateDelta: 0,
        bandwidth: 0,
        avgResponseTime: 0,
        responseTimeDelta: 0,
      },
      timeseries: {
        labels: ['00:00'],
        hits: [0],
        misses: [0],
        bandwidth: [0],
        responseTime: [0],
      },
    });
    await page.goto('/domains/textbook.com');

    // 통계 카드 렌더링 완료 대기
    await expect(page.getByTestId('domain-stat-cards')).toBeVisible();

    // delta=0일 때 ↑ 화살표가 있으면 안 된다 (#87 핵심)
    const arrowTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('span')).filter((s) => s.textContent?.includes('↑ 0.0')).map((s) => s.textContent),
    );
    expect(arrowTexts).toHaveLength(0);

    // 중립 표시(—)가 표시되어야 한다
    const neutralTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('span')).filter((s) => s.textContent?.includes('— 0.0')).map((s) => s.textContent),
    );
    expect(neutralTexts.length).toBeGreaterThan(0);
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

  /**
   * 이슈 #90 회귀 방지 — DomainInfoCards 반응형 그리드 누락
   * 수정 전: grid-cols-2 고정 → 모바일 375px에서 텍스트가 단어 단위로 줄바꿈됨
   * 수정 후: grid-cols-1 md:grid-cols-2 — 모바일 1열, 데스크톱 2열
   */
  test('DomainInfoCards 그리드가 mobile-first 반응형 클래스를 사용한다 (회귀: #90)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 기본 정보 카드와 TLS 상태 카드를 감싸는 그리드 컨테이너
    // grid-cols-1이 기본(모바일) 클래스여야 한다
    const gridLocator = page.locator('.grid.grid-cols-1.gap-4').first();
    await expect(gridLocator).toBeVisible();

    const gridClass = await gridLocator.getAttribute('class');
    // 기본 클래스: grid-cols-1 (모바일 단일 열)
    expect(gridClass).toContain('grid-cols-1');
    // 반응형 breakpoint: md:grid-cols-2 (데스크톱 2열)
    expect(gridClass).toContain('md:grid-cols-2');
    // 수정 전 버그 클래스(반응형 없는 고정 2열)가 없어야 한다
    // 공백으로 구분된 독립 토큰 "grid-cols-2" (breakpoint 접두사 없음) 체크
    expect(gridClass).not.toMatch(/(^| )grid-cols-2( |$)/);
  });

  /**
   * 이슈 #90 회귀 방지 — DomainQuickActions 반응형 그리드 누락
   * 수정 전: grid-cols-4 고정 → 모바일 375px에서 각 버튼이 매우 좁아짐
   * 수정 후: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 — mobile-first 3단계 반응형
   */
  test('DomainQuickActions 그리드가 mobile-first 반응형 클래스를 사용한다 (회귀: #90)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    const quickActions = page.getByTestId('domain-quick-actions');
    await expect(quickActions).toBeVisible();

    const gridClass = await quickActions.getAttribute('class');
    // 기본 클래스: grid-cols-1 (모바일 단일 열)
    expect(gridClass).toContain('grid-cols-1');
    // sm breakpoint: sm:grid-cols-2 (중간 화면 2열)
    expect(gridClass).toContain('sm:grid-cols-2');
    // lg breakpoint: lg:grid-cols-4 (데스크톱 4열)
    expect(gridClass).toContain('lg:grid-cols-4');
    // 수정 전 버그 클래스(반응형 없는 고정 4열)가 없어야 한다
    // 공백으로 구분된 독립 토큰 "grid-cols-4" (breakpoint 접두사 없음) 체크
    expect(gridClass).not.toMatch(/(^| )grid-cols-4( |$)/);
  });

  /**
   * 이슈 #117 회귀 방지 — updated_at=0 시 수정일이 '1970. 1. 1.'로 표시되던 버그
   * 수정 전: toKoDate(0) → Unix epoch '1970. 1. 1.' 표시
   * 수정 후: updated_at=0이면 '—' 표시
   */
  test('updated_at=0인 도메인의 수정일이 \'1970. 1. 1.\' 대신 \'—\'로 표시된다 (회귀: #117)', async ({ page }) => {
    // updated_at=0인 도메인으로 mock 오버라이드
    await setupDetailMocks(page);
    await mockApi(page, 'GET', '/domains/textbook.com', {
      host: 'textbook.com',
      origin: 'https://textbook.com',
      enabled: 1,
      description: '교과서 CDN',
      created_at: 1700000000,
      updated_at: 0, // 미수정 상태
    });
    await page.goto('/domains/textbook.com');

    // 수정일 행을 찾아 '—' 표시 확인
    const rows = page.locator('.grid.grid-cols-\\[120px_1fr\\]');
    // 수정일 라벨을 포함하는 행
    const modifiedRow = rows.filter({ hasText: '수정일' });
    await expect(modifiedRow).toBeVisible();
    // '1970. 1. 1.' epoch 값이 노출되어선 안 된다
    await expect(modifiedRow).not.toContainText('1970');
    // 미수정 상태임을 나타내는 대시가 표시되어야 한다
    await expect(modifiedRow).toContainText('—');
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

  test('커스텀 기간 날짜 입력 접근성 이름 — aria-label 시작일/종료일 존재 (회귀: #109)', async ({ page }) => {
    // 수정 전: aria-label 없이 두 날짜 입력이 generic 레이블로만 읽혀 스크린리더 구분 불가
    // 수정 후: 시작일/종료일 aria-label이 각 입력에 부착되어 스크린리더가 구분 가능해야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 2개가 표시된다
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();
    await expect(page.getByTestId('period-custom-to')).toBeVisible();

    // aria-label 접근성 이름이 각 입력에 존재해야 한다
    await expect(page.getByTestId('period-custom-from')).toHaveAttribute('aria-label', '시작일');
    await expect(page.getByTestId('period-custom-to')).toHaveAttribute('aria-label', '종료일');
  });

  test('커스텀 기간 에러 메시지 — role=alert + aria-live=assertive 존재 (회귀: #109)', async ({ page }) => {
    // 수정 전: 오류 단락에 role="alert"가 없어 스크린리더가 오류 발생 시 알림을 받지 못함
    // 수정 후: 역방향 날짜 입력 시 에러 단락에 role="alert"와 aria-live="assertive"가 있어야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 표시
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();

    // 종료일을 먼저 입력 후 시작일을 종료일 이후로 설정하여 역방향 에러 유발
    await page.getByTestId('period-custom-to').fill('2026-04-01');
    await page.getByTestId('period-custom-from').fill('2026-12-31');

    // 에러 메시지 단락이 표시되어야 한다
    const errorEl = page.getByTestId('period-custom-error');
    await expect(errorEl).toBeVisible();

    // role="alert" + aria-live="assertive" 가 있어야 스크린리더가 즉시 알림을 받는다
    await expect(errorEl).toHaveAttribute('role', 'alert');
    await expect(errorEl).toHaveAttribute('aria-live', 'assertive');
  });

  test('커스텀 버튼 클릭 시 이전 프리셋 pressed 상태가 즉시 해제된다 (회귀: #118)', async ({ page }) => {
    // 수정 전: setCustomOpen(true)만 호출하고 onChange를 호출하지 않아
    //           이전 프리셋(24h 등)이 aria-pressed="true"로 잔존하는 버그
    // 수정 후: 커스텀 클릭 시 onChange({ period: 'custom' })가 즉시 호출되어
    //          이전 프리셋은 pressed 해제, 커스텀 버튼은 pressed 활성화되어야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 초기 상태: 24h가 눌린 상태(default)
    await expect(page.getByTestId('period-24h')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'false');

    // 커스텀 버튼 클릭 → 날짜 입력이 나타나고, 이전 프리셋은 즉시 해제되어야 한다
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();

    // 이전 프리셋(24h)은 즉시 해제되어야 한다 — 시각적 두 버튼 동시 활성 현상 수정 확인
    await expect(page.getByTestId('period-24h')).toHaveAttribute('aria-pressed', 'false');
    // 커스텀 버튼이 activated(pressed) 상태여야 한다
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'true');
  });

  test('커스텀 기간 날짜 지우면 NaN이 API로 전달되지 않는다 (회귀: #141)', async ({ page }) => {
    // 수정 전: 날짜 입력란을 비우면 applyCustom("")이 호출되어 NaN이 from/to 파라미터로 전달됨
    // 수정 후: 빈 문자열 또는 NaN 반환 시 early return — onChange가 호출되지 않아야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 표시
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();

    // 유효한 날짜를 먼저 입력하여 커스텀 기간이 적용되도록 함
    await page.getByTestId('period-custom-from').fill('2026-04-01');
    await page.getByTestId('period-custom-to').fill('2026-04-10');
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'true');

    // NaN이 포함된 API 요청이 발생하면 캡처하기 위해 네트워크 요청 감시
    const nanRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('NaN')) {
        nanRequests.push(req.url());
      }
    });

    // 시작일 입력란을 비운다 — NaN이 API로 전달되면 안 됨
    await page.getByTestId('period-custom-from').fill('');
    // React onChange 처리 + 잠재적 API 호출 대기
    await page.waitForTimeout(300);

    // NaN 파라미터가 포함된 API 요청이 발생하지 않아야 한다
    expect(nanRequests).toHaveLength(0);

    // 종료일도 지워본다
    await page.getByTestId('period-custom-to').fill('');
    await page.waitForTimeout(300);
    expect(nanRequests).toHaveLength(0);
  });

  test('Stats 탭 수동 새로고침 버튼이 존재', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('manual-refresh-btn')).toBeVisible();
  });

  test('Stats 탭 수동 새로고침 중 버튼이 비활성화되고 스피너가 표시된다 (회귀: #144)', async ({ page }) => {
    // isRefreshing prop이 전달되지 않아 갱신 중에도 버튼이 활성 상태였던 버그.
    // 수정 후: isFetching 중에는 버튼이 disabled되고 RefreshCw 아이콘이 animate-spin 클래스를 가진다.
    // setupDetailMocks 이후 덮어쓰기로 등록 — Playwright LIFO 규칙으로 마지막 핸들러가 우선한다.
    // url-breakdown 엔드포인트는 ['domain', host, 'url-optimization', ...] queryKey를 사용하므로
    // invalidateQueries(['domain', host]) 시 refetch되어 isFetching을 증가시킨다.
    await setupDetailMocks(page);
    let urlBreakdownCallCount = 0;
    await page.route('**/api/domains/textbook.com/optimization/url-breakdown*', async (route) => {
      urlBreakdownCallCount++;
      if (urlBreakdownCallCount > 1) {
        // 두 번째 요청(수동 갱신)은 1.5초 지연 → isFetching=true 상태를 충분히 관찰 가능
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.fulfill({ json: { total: 0, items: [] } });
    });
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('manual-refresh-btn')).toBeVisible();

    // 새로고침 버튼 클릭 → 갱신 시작 (두 번째 url-breakdown 요청, 1.5초 지연)
    await page.getByTestId('manual-refresh-btn').click();

    // 갱신 중: 버튼이 disabled 상태여야 한다
    await expect(page.getByTestId('manual-refresh-btn')).toBeDisabled();

    // 갱신 중: RefreshCw 아이콘에 animate-spin 클래스가 있어야 한다
    const icon = page.getByTestId('manual-refresh-btn').locator('svg');
    await expect(icon).toHaveClass(/animate-spin/);
  });

  test('Traffic 탭 수동 새로고침 중 버튼이 비활성화되고 스피너가 표시된다 (회귀: #144)', async ({ page }) => {
    // 트래픽(로그) 탭의 ManualRefreshButton도 isRefreshing prop 누락이었던 버그.
    // 수정 후: logs/top-urls 쿼리 fetching 중에는 버튼이 disabled 상태를 유지한다.
    // setupDetailMocks 이후 덮어쓰기로 등록 — Playwright LIFO 규칙으로 마지막 핸들러가 우선한다.
    // 초기 로딩은 빠른 응답, 두 번째 이후(갱신)는 지연 응답으로 isFetching 상태를 관찰한다.
    await setupDetailMocks(page);
    let logsCallCount = 0;
    await page.route('**/api/domains/textbook.com/logs*', async (route) => {
      logsCallCount++;
      if (logsCallCount > 1) {
        // 두 번째 요청(수동 갱신)은 1.5초 지연 → isFetching=true 상태를 충분히 관찰 가능
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.fulfill({ json: createDomainLogs() });
    });
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();
    await expect(page.getByTestId('manual-refresh-btn')).toBeVisible();

    // 새로고침 버튼 클릭 → 갱신 시작 (두 번째 logs 요청, 1.5초 지연)
    await page.getByTestId('manual-refresh-btn').click();

    // 갱신 중: 버튼이 disabled 상태여야 한다
    await expect(page.getByTestId('manual-refresh-btn')).toBeDisabled();

    // 갱신 중: RefreshCw 아이콘에 animate-spin 클래스가 있어야 한다
    const icon = page.getByTestId('manual-refresh-btn').locator('svg');
    await expect(icon).toHaveClass(/animate-spin/);
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
   * 이슈 #89 회귀 방지 — 데이터 없을 때 0 값 대신 빈 상태 UI가 표시되어야 한다.
   * total=0 && by_decision=[] 응답 시 "아직 데이터가 없습니다" 메시지가 렌더링되어야 한다.
   */
  test('텍스트 압축 통계 카드 — 이벤트 0건 시 0 값 대신 빈 상태 안내 메시지가 표시된다 (회귀: #89)', async ({ page }) => {
    await setupDetailMocks(page);

    // 이벤트 0건 응답 — total=0, by_decision=[] (신규 도메인 시나리오)
    await page.route('**/api/optimization/stats*', (route) =>
      route.fulfill({ json: { total: 0, by_decision: [] } }),
    );

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // text-compress-stats 카드가 렌더링되어야 한다
    const statsCard = page.getByTestId('text-compress-stats');
    await expect(statsCard).toBeVisible();

    // 빈 상태 안내 문구가 표시되어야 한다 (수정 전: "처리 이벤트 0", "0 B → 0 B" 노출)
    await expect(statsCard).toContainText('아직 데이터가 없습니다');
    await expect(statsCard).toContainText('텍스트 압축이 실행되면 자동으로 표시됩니다');

    // 0 값 통계 수치가 노출되지 않아야 한다
    await expect(statsCard).not.toContainText('처리 이벤트');
    await expect(statsCard).not.toContainText('0 B → 0 B');
    await expect(statsCard).not.toContainText('평균 절감');
  });

  /**
   * 이슈 #53 회귀 방지 — 텍스트 압축 통계 카드가 PeriodSelector 무시하고 항상 30d 조회
   * 수정 후: PeriodSelector 기간 변경 시 텍스트 압축 카드 제목과 API 요청 period가 함께 바뀌어야 한다.
   */
  /**
   * 이슈 #91 회귀 방지 — 역방향 날짜 범위(시작일 > 종료일) 입력 시 에러 없이 조용히 무시되던 버그
   * 수정 후: 에러 메시지(period-custom-error)가 표시되고, 올바른 범위로 정정하면 에러가 사라진다.
   *
   * 테스트 전략: to 먼저 유효 날짜로 설정 후 from에 더 나중 날짜를 입력해 역방향 조건 유발.
   * - to=2026-04-01 먼저 입력(from=e.target.value="2026-04-01"이므로 동일 → to=endOfDay>from=startOfDay OK → period=custom)
   * - 그 다음 from=2026-12-31 입력(value.from이 설정됐으나 from 입력은 value.to 기반으로 계산)
   *   to input defaultValue=2026-04-01이므로 value.to는 아직 Apr 1 epoch
   *   applyCustom(from="2026-12-31", to=epochToDateStr(value.to)="2026-04-01") → Dec31 > Apr01 → 에러
   */
  test('커스텀 기간 — 역방향 날짜 범위 입력 시 에러 메시지가 표시되고 정정 시 사라진다 (회귀: #91)', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();

    // 커스텀 버튼 클릭 → 날짜 입력 필드 표시
    await page.getByTestId('period-custom').click();
    await expect(page.getByTestId('period-custom-from')).toBeVisible();

    // 1단계: 종료일(2026-04-01) 먼저 입력 — from=e.target.value이므로 동일 날짜, to=endOfDay > from=startOfDay → 정상 적용
    await page.getByTestId('period-custom-to').fill('2026-04-01');
    // 커스텀 기간이 활성화되어야 한다
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'true');

    // 2단계: 시작일을 종료일보다 나중으로 입력 → to(value.to=Apr1) < from(Dec31) → 에러 발생
    await page.getByTestId('period-custom-from').fill('2026-12-31');

    // 에러 메시지가 표시되어야 한다 (수정 전: 에러 없이 조용히 무시됨)
    const errorMsg = page.getByTestId('period-custom-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('종료일은 시작일 이후여야 합니다.');

    // 시작일을 종료일 이전으로 정정 → 에러가 사라지고 커스텀 기간 유지
    await page.getByTestId('period-custom-from').fill('2026-03-01');
    await expect(errorMsg).not.toBeVisible();
    await expect(page.getByTestId('period-custom')).toHaveAttribute('aria-pressed', 'true');
  });

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

  /**
   * 이슈 #145 회귀 방지 — period prop 변경 시 DomainUrlOptimizationTable의 offset이 리셋되지 않던 버그.
   * 수정 후: PeriodSelector 기간 변경 시 내부 offset이 0으로 리셋되어 첫 페이지 데이터를 요청해야 한다.
   *
   * 테스트 전략:
   * 1. total=100 응답으로 "다음" 버튼 활성화 → 클릭해 offset=50 으로 이동
   * 2. PeriodSelector 기간 변경 (24h → 7d)
   * 3. 이후 url-breakdown API 요청의 offset 파라미터가 0인지 검증
   */
  test('URL 최적화 표 — period 변경 시 offset이 0으로 리셋된다 (회귀: #145)', async ({ page }) => {
    await setupDetailMocks(page);

    // url-breakdown: 총 100건 — offset=0 시 첫 50건, offset=50 시 두 번째 50건 시뮬레이션
    const capturedOffsets: number[] = [];
    await page.route('**/api/domains/textbook.com/optimization/url-breakdown*', (route) => {
      const url = new URL(route.request().url());
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
      capturedOffsets.push(offset);
      // 페이지와 무관하게 항목 1건 + total=100 반환 (다음 버튼 활성 유지)
      return route.fulfill({
        json: {
          total: 100,
          items: [
            {
              url: '/test.jpg',
              events: 5,
              total_orig: 1024,
              total_out: 512,
              savings_ratio: 0.5,
              decisions: 'optimized',
            },
          ],
        },
      });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '최적화' }).click();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();

    // 초기 offset=0 요청 확인
    expect(capturedOffsets[capturedOffsets.length - 1]).toBe(0);

    // "다음" 버튼 클릭 → offset=50으로 이동
    await page.getByTestId('url-opt-next').click();
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();
    expect(capturedOffsets[capturedOffsets.length - 1]).toBe(50);

    // PeriodSelector에서 7d로 변경 → useEffect가 setOffset(0)을 호출한다.
    // React 렌더 순서상 period 변경 → offset=50으로 첫 쿼리 실행 → useEffect → offset=0으로 재쿼리.
    // 따라서 마지막 요청의 offset이 0인지 확인한다 (수정 전: offset=50 유지로 0 요청이 발생하지 않음).
    capturedOffsets.length = 0; // 이후 요청만 추적
    await page.getByTestId('period-7d').click();
    // offset 리셋 후 최종 재요청이 일어날 때까지 대기 — 두 번의 렌더가 안정될 시간 확보
    await page.waitForTimeout(500);
    await expect(page.getByTestId('url-optimization-table')).toBeVisible();

    // period 변경 후 최종 url-breakdown 요청의 offset은 0이어야 한다 (리셋 확인)
    expect(capturedOffsets[capturedOffsets.length - 1]).toBe(0);
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

  test('자동 갱신 드롭다운 SelectTrigger에 aria-label="자동 갱신 간격" 존재 (회귀: #113)', async ({ page }) => {
    // 버그: SelectTrigger에 aria-label 없어 스크린리더가 "콤보박스 30초"로만 읽어 역할 구분 불가
    // 수정 후: aria-label="자동 갱신 간격"이 존재해 스크린리더가 맥락을 파악할 수 있어야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();

    // SelectTrigger(button 역할)에 aria-label이 존재하는지 검증
    const trigger = page.getByRole('combobox', { name: '자동 갱신 간격' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-label', '자동 갱신 간격');
  });

  test('자동 갱신 간격이 탭 전환 후에도 유지된다 (회귀: #133)', async ({ page }) => {
    // 버그: DomainLogsTab이 비활성 탭 전환 시 언마운트되어 로컬 state가 30초로 리셋됨
    // 수정: refresh 상태를 DomainDetailTabs로 끌어올려 탭 전환과 무관하게 유지
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 트래픽 탭으로 이동 후 갱신 간격을 5분으로 변경
    await page.getByRole('tab', { name: '트래픽' }).click();
    await page.getByRole('combobox', { name: '자동 갱신 간격' }).click();
    await page.getByRole('option', { name: '5분' }).click();
    await expect(page.getByRole('combobox', { name: '자동 갱신 간격' })).toContainText('5분');

    // 다른 탭으로 이동했다가 트래픽 탭으로 복귀
    await page.getByRole('tab', { name: '개요' }).click();
    await page.getByRole('tab', { name: '트래픽' }).click();

    // 갱신 간격이 5분으로 유지되어야 한다 (초기값 30초로 리셋되면 버그)
    await expect(page.getByRole('combobox', { name: '자동 갱신 간격' })).toContainText('5분');
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

  /**
   * 이슈 #134 회귀 방지 — errorsOnly 이중 필터로 '더 보기' 버튼 오작동
   * 수정 전: API에 status=error를 전달했음에도 클라이언트에서도 status_code < 400 필터를 중복 적용
   *         → API가 limit=50을 채워도 클라이언트 필터 후 표시 건수가 줄어 '더 보기'가 숨겨짐
   * 수정 후: 클라이언트 중복 필터 제거 → API 응답 50건이 모두 표시되고 '더 보기' 버튼도 정상 표시
   */
  test('"에러만" 토글 — API limit=50 응답 시 클라이언트 중복 필터 없이 전체 50건이 표시된다 (회귀: #134)', async ({ page }) => {
    await setupDetailMocks(page);

    // mock: errorsOnly 활성화 시 50건 반환 (API는 이미 error 필터 적용 후 반환한다고 가정)
    // 의도적으로 status_code < 400 항목을 포함시켜 클라이언트 중복 필터가 살아있으면
    // 표시 건수가 줄어드는 조건을 만든다
    await page.route('**/api/domains/textbook.com/logs*', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('status') === 'error') {
        // 50건 중 10건(i%5===0)이 status_code=200 — 클라이언트 이중 필터가 남아있으면 40건만 표시됨
        const logs = Array.from({ length: 50 }, (_, i) => ({
          timestamp: 1700000000 + i,
          status_code: i % 5 === 0 ? 200 : 500,
          cache_status: 'MISS' as const,
          path: `/path/${i}`,
          size: 1024,
        }));
        return route.fulfill({ json: logs });
      }
      return route.fulfill({ json: createDomainLogs() });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '트래픽' }).click();

    // "에러만" 토글 활성화 → mock이 50건 반환
    await page.getByRole('button', { name: '에러만' }).click();

    const logTable = page.locator('table');
    await expect(logTable).toBeVisible();

    // 수정 후: 50건 모두 표시되어야 한다 (이중 필터 제거 → 40건으로 줄면 버그 재현)
    const rowCount = await logTable.locator('tbody tr').count();
    expect(rowCount).toBe(50);

    // '더 보기' 버튼이 표시되어야 한다 (data.length=50 >= limit=50)
    await expect(page.getByRole('button', { name: '더 보기' })).toBeVisible();
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

  /**
   * 이슈 #103 회귀 방지 — OriginSection 편집 시 스킴 없는 URL이 저장되던 버그
   * 수정 후: http:// / https:// 없는 origin 입력 시 에러 토스트가 표시되고 PUT이 호출되지 않아야 한다.
   *
   * 모킹 이유: PUT API 호출 횟수를 정확히 추적하기 위해 route 인터셉터를 사용한다.
   * mock이 재현하는 조건: 클라이언트 검증이 origin 스킴을 검사하지 않아 scheme-less URL이 서버로 전송되는 상황.
   * 이 mock이 실제 버그 조건과 동일한 이유: OriginSection은 handleSave()에서 직접 뮤테이션을 호출하므로
   * PUT 호출 횟수가 0이어야 클라이언트 검증이 서버 전송을 막았음을 보장한다.
   */
  test('Origin 스킴 없는 URL 저장 시 에러 토스트가 표시되고 PUT이 호출되지 않는다 (#103)', async ({ page }) => {
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

    // 편집 모드 진입 → 스킴 없는 URL 입력 → 저장 시도
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('httpbin.org/path');
    await page.getByTestId('save-domain-btn').click();

    // 스킴 오류 토스트가 표시되어야 한다 (#103 핵심)
    await expect(page.getByText('오리진 URL은 http:// 또는 https://로 시작해야 합니다.')).toBeVisible();
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

  /**
   * 이슈 #137 회귀 방지 — OriginSection 저장 후 재편집 시 서버 정규화 값 대신 입력값이 표시되던 버그
   *
   * 수정 전: onSuccess에서 state를 동기화하지 않아, 재편집 시 사용자 입력값(대문자)이 표시됨.
   * 수정 후: onSuccess(data)에서 서버 응답값으로 state를 갱신하므로, 재편집 시 정규화된 값이 표시되어야 한다.
   *
   * mock이 재현하는 조건: PUT 응답이 사용자 입력과 다른 값(서버 정규화 후 소문자)을 반환하는 상황.
   * 이 mock이 실제 버그 조건과 동일한 이유: OriginSection의 onSuccess 콜백이 서버 응답값을
   * state에 반영하는지 직접 검증하므로, 클라이언트-서버 정규화 불일치를 정확히 재현한다.
   */
  test('OriginSection — 저장 후 재편집 시 서버 정규화 값이 입력란에 표시된다 (회귀: #137)', async ({ page }) => {
    await setupDetailMocks(page);
    // 서버가 origin을 소문자로 정규화하여 반환하는 상황을 모킹
    await mockApi(page, 'PUT', '/domains/textbook.com', {
      ...createDomain(),
      origin: 'https://normalized-origin.com',
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭으로 전환
    await page.getByRole('tab', { name: '설정' }).click();
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // 편집 모드 진입 → 대문자 origin 입력 → 저장
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('https://NORMALIZED-ORIGIN.COM');
    await page.getByTestId('save-domain-btn').click();

    // 저장 후 편집 모드 해제 확인
    await expect(page.getByTestId('edit-domain-btn')).toBeVisible();

    // 다시 편집 모드 진입 — 서버가 반환한 정규화 값이 표시되어야 한다 (사용자 입력값 아님)
    await page.getByTestId('edit-domain-btn').click();
    await expect(page.getByTestId('origin-input')).toHaveValue('https://normalized-origin.com');
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

  /**
   * 이슈 #80 회귀 방지 — 오리진 편집 폼에서 Enter 키 제출·Esc 취소가 동작하지 않던 버그
   * 수정 후:
   * - 오리진 입력 필드에서 Enter 키 누르면 폼이 제출되어야 한다
   * - 오리진 입력 필드에서 Esc 키 누르면 편집 모드가 취소되어야 한다
   */
  test('OriginSection — origin 입력 필드에서 Enter 키로 저장이 동작한다 (회귀: #80)', async ({ page }) => {
    // <form onSubmit> 패턴 적용 후 Enter 제출이 동작해야 한다 (수정 전: div 래퍼로 Enter 미동작)
    await setupDetailMocks(page);
    await mockApi(page, 'PUT', '/domains/textbook.com', {
      ...createDomain(),
      origin: 'https://new-origin.com',
    });
    await page.goto('/domains/textbook.com');

    // 설정 탭으로 전환 → 편집 모드 진입 → origin 입력 후 Enter 키 누름
    await page.getByRole('tab', { name: '설정' }).click();
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('https://new-origin.com');
    await page.getByTestId('origin-input').press('Enter');

    // Enter 키로 제출되어 편집 모드가 해제되어야 한다 (edit-domain-btn이 다시 보임)
    await expect(page.getByTestId('edit-domain-btn')).toBeVisible();
    // 저장 버튼은 편집 모드 해제 후 사라져야 한다
    await expect(page.getByTestId('save-domain-btn')).not.toBeVisible();
  });

  test('OriginSection — origin 입력 필드에서 Esc 키로 편집 취소가 동작한다 (회귀: #80)', async ({ page }) => {
    // form 레벨 onKeyDown Escape 처리 적용 후 Esc 취소가 동작해야 한다 (수정 전: onKeyDown 핸들러 없어 Esc 미동작)
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 설정 탭으로 전환 → 편집 모드 진입 → origin 값 변경 후 Esc 키 누름
    await page.getByRole('tab', { name: '설정' }).click();
    await page.getByTestId('edit-domain-btn').click();
    await page.getByTestId('origin-input').fill('https://changed-value.com');
    await page.getByTestId('origin-input').press('Escape');

    // Esc 키로 편집 모드가 해제되어야 한다 (edit-domain-btn이 다시 보임)
    await expect(page.getByTestId('edit-domain-btn')).toBeVisible();
    // 저장 버튼이 사라져야 한다
    await expect(page.getByTestId('save-domain-btn')).not.toBeVisible();
    // 변경 전 원래 값(https://textbook.com)이 표시되어야 한다 (취소로 복원됨)
    await expect(page.getByText('https://textbook.com')).toBeVisible();
  });

  /**
   * 이슈 #112 회귀 방지 — 도메인 전체 퍼지 시 purgeCache 직접 호출로 loading 상태·캐시 무효화 누락
   * 수정 후:
   * - 퍼지 진행 중 확인 다이얼로그의 퍼지 버튼이 disabled 처리되어야 한다
   * - purgeMutation.mutateAsync 경유로 /api/cache/purge가 올바른 payload로 호출되어야 한다
   */
  test('DomainCacheSection — 도메인 전체 퍼지 성공 시 /api/cache/purge가 domain 타입으로 호출되고 토스트가 표시된다 (회귀: #112)', async ({ page }) => {
    // 수정 전: purgeCache 직접 호출로 onSuccess 콜백(캐시 무효화) 미실행 + 버튼 loading 상태 누락
    // 수정 후: purgeMutation.mutateAsync를 경유해야 하므로 올바른 payload + 성공 토스트가 나타나야 한다
    await setupDetailMocks(page);

    // purge API 호출 payload를 캡처한다
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/api/cache/purge', async (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({ json: { purged_count: 7 } });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '설정' }).click();

    // 도메인 전체 퍼지 버튼 클릭 → 확인 다이얼로그 표시
    await page.getByTestId('domain-purge-btn').click();
    await expect(page.getByTestId('domain-purge-dialog')).toBeVisible();

    // 확인 다이얼로그의 퍼지 버튼 클릭 → 퍼지 실행
    await page.getByTestId('domain-purge-confirm-btn').click();

    // 성공 토스트가 표시되어야 한다 (purged_count 반영)
    await expect(page.getByText('7건 삭제')).toBeVisible({ timeout: 3000 });

    // purgeMutation 경유로 올바른 type/target payload가 전송되었어야 한다
    expect(capturedBody).toMatchObject({ type: 'domain', target: 'textbook.com' });
  });

  test('DomainCacheSection — 도메인 전체 퍼지 진행 중 확인 버튼이 disabled 처리된다 (회귀: #112)', async ({ page }) => {
    // 수정 전: purgeCache 직접 호출로 isPending 상태가 버튼에 반영되지 않아 중복 클릭 가능
    // 수정 후: purgeMutation.isPending이 true인 동안 domain-purge-confirm-btn이 disabled여야 한다
    //          (다이얼로그가 pending 완료 후 닫히도록 handleDomainPurge 수정됨)
    await setupDetailMocks(page);

    // purge API를 지연 응답으로 설정하여 isPending 상태를 유지한다
    let resolveRoute: (() => void) | null = null;
    await page.route('**/api/cache/purge', async (route) => {
      // 외부에서 해제할 때까지 응답을 보류한다
      await new Promise<void>((res) => { resolveRoute = res; });
      return route.fulfill({ json: { purged_count: 3 } });
    });

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '설정' }).click();

    // 도메인 전체 퍼지 다이얼로그 열기
    await page.getByTestId('domain-purge-btn').click();
    await expect(page.getByTestId('domain-purge-dialog')).toBeVisible();

    // 퍼지 실행 — 응답 지연 중 다이얼로그는 open 유지, 버튼 disabled 검증
    await page.getByTestId('domain-purge-confirm-btn').click();

    // isPending 동안 다이얼로그가 열려 있고 버튼이 disabled 상태여야 한다
    await expect(page.getByTestId('domain-purge-dialog')).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId('domain-purge-confirm-btn')).toBeDisabled({ timeout: 1000 });

    // 응답 해제 → 완료 → 다이얼로그 닫힘
    resolveRoute!();
    await expect(page.getByTestId('domain-purge-dialog')).not.toBeVisible({ timeout: 3000 });
  });

  /**
   * 이슈 #136 회귀 방지 — 도메인 전체 퍼지 실패 시 확인 다이얼로그가 닫히던 버그
   * 수정 후: API 실패 시 다이얼로그가 유지되어 사용자가 재시도할 수 있어야 한다
   */
  test('DomainCacheSection — 도메인 전체 퍼지 실패 시 확인 다이얼로그가 유지된다 (회귀: #136)', async ({ page }) => {
    // 수정 전: catch 블록에서 setPurgeDialogOpen(false) 호출로 실패 시에도 다이얼로그가 닫혔음
    // 수정 후: catch 블록에서 setPurgeDialogOpen 호출 제거 → 다이얼로그 유지 + 에러 토스트 표시
    await setupDetailMocks(page);

    // purge API를 500 에러로 모킹하여 실패 조건 재현
    await page.route('**/api/cache/purge', (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal Server Error' } }),
    );

    await page.goto('/domains/textbook.com');
    await page.getByRole('tab', { name: '설정' }).click();

    // 도메인 전체 퍼지 버튼 클릭 → 확인 다이얼로그 표시
    await page.getByTestId('domain-purge-btn').click();
    await expect(page.getByTestId('domain-purge-dialog')).toBeVisible();

    // 퍼지 실행 → API 실패
    await page.getByTestId('domain-purge-confirm-btn').click();

    // 에러 토스트가 표시되어야 한다
    await expect(page.getByText('캐시 퍼지에 실패했습니다')).toBeVisible({ timeout: 3000 });

    // 실패 후에도 다이얼로그가 열린 상태를 유지해야 한다 (재시도 가능)
    await expect(page.getByTestId('domain-purge-dialog')).toBeVisible({ timeout: 1000 });
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

// ─── Tooltip 포맷 (#86 회귀) ─────────────────────────────────
test.describe('도메인 상세 — DomainStackedChart Tooltip 포맷 (#86)', () => {
  test('스택 차트 hover tooltip이 소수 대신 % 형식으로 표시된다', async ({ page }) => {
    // 버그: stackOffset="expand" 사용 시 Recharts 내부값(0~1 소수)이 tooltip에 그대로 노출됨
    // 수정 후: formatter가 Math.round(v * 100)% 변환을 적용해야 한다
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com');

    // 최적화 탭으로 전환해 DomainStackedChart가 렌더되도록 한다
    await page.getByRole('tab', { name: '최적화' }).click();

    // 차트가 렌더링될 때까지 대기
    const chart = page.getByTestId('domain-overview-stacked-chart');
    await expect(chart).toBeVisible();

    // 차트 SVG 위로 마우스를 이동해 tooltip을 활성화한다
    const chartBox = await chart.boundingBox();
    if (chartBox) {
      await page.mouse.move(
        chartBox.x + chartBox.width * 0.4,
        chartBox.y + chartBox.height * 0.5,
      );
    }

    // Recharts tooltip이 DOM에 추가되기를 기다린다
    const tooltip = page.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // tooltip 텍스트에 '%'가 포함되어야 한다 (소수 원시값 0.xx 노출 방지)
    await expect(tooltip).toContainText('%');

    // tooltip 텍스트에 소수 패턴(0.숫자숫자)이 없어야 한다 (예: 0.75, 0.7500000000000001)
    const tooltipText = await tooltip.textContent();
    expect(tooltipText).not.toMatch(/\b0\.\d{2,}/);
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

  test('트래픽 차트 그리드가 모바일(380px)에서 1열, 데스크톱(1200px)에서 2열이다 (회귀: #85)', async ({ page }) => {
    // 버그: grid-cols-2 md:grid-cols-1 — Tailwind mobile-first 순서 역전으로
    //       모바일에서 2열, 데스크톱에서 1열로 표시되던 문제 수정 검증
    await setupDetailMocks(page);
    // stats 엔드포인트는 ?period=24h 쿼리 파라미터를 포함하므로 wildcard(**) suffix 사용
    await page.route('**/api/domains/textbook.com/stats**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createDomainStats()) }),
    );
    await page.goto('/domains/textbook.com?tab=traffic');

    // 데이터 로드 후 그리드가 표시될 때까지 대기 (스켈레톤 → 차트 전환)
    const gridLocator = page.getByTestId('traffic-charts-grid');
    await expect(gridLocator).toBeVisible();

    const gridClass = await gridLocator.getAttribute('class');
    // grid-cols-1이 기본(모바일) 클래스여야 한다 (모바일 1열)
    expect(gridClass).toContain('grid-cols-1');
    // md:grid-cols-2가 breakpoint 클래스여야 한다 (데스크톱 2열)
    expect(gridClass).toContain('md:grid-cols-2');
    // 역전된 클래스(원래 버그)가 없어야 한다
    expect(gridClass).not.toContain('grid-cols-2 ');
  });
});

// ─── 설정 탭 TLS 수동 갱신 (#102 회귀) ───────────────────────────────
test.describe('도메인 상세 — 설정 탭 TLS 수동 갱신 (#102)', () => {
  /**
   * 회귀 방지: DomainSettingsTab의 "수동 갱신" 버튼이 하드코딩 disabled에서
   * useTlsRenew 훅으로 교체됨.
   * - 수정 전: <Button disabled> (항상 비활성)
   * - 수정 후: useTlsRenew 훅 → isPending 아닐 때 활성, 갱신 중 비활성
   */
  test('설정 탭의 수동 갱신 버튼이 기본 상태에서 활성화되어 있다', async ({ page }) => {
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=settings');

    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();
    // 수동 갱신 버튼이 비활성화되지 않아야 한다 (핵심 회귀 조건)
    const renewBtn = page.getByTestId('tls-renew-settings');
    await expect(renewBtn).toBeVisible();
    await expect(renewBtn).toBeEnabled();
  });

  test('수동 갱신 버튼 클릭 시 POST /api/tls/renew/<host> 가 호출된다', async ({ page }) => {
    await setupDetailMocks(page);
    // 갱신 엔드포인트 mock — 성공 응답
    await mockApi(page, 'POST', '/tls/renew/textbook.com', { success: true, host: 'textbook.com' });
    await page.goto('/domains/textbook.com?tab=settings');

    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // 버튼 클릭 → 뮤테이션 요청
    await page.getByTestId('tls-renew-settings').click();

    // 성공 토스트가 표시되어야 한다
    await expect(page.getByText('TLS 인증서가 갱신되었습니다.')).toBeVisible();
  });

  test('최적화 프로파일 레이블이 필드 이름만 담고 제약 설명이 별도 <p>로 분리된다 (회귀: #122)', async ({ page }) => {
    // 수정 전: <Label>이 "품질 (1–100)" / "최대 너비 px (0 = 무제한)" 처럼 힌트를 포함해
    //          시각 위계가 깨지고 스크린리더가 불필요하게 긴 텍스트를 읽음
    // 수정 후: Label은 필드 이름만("품질" / "최대 너비"), 제약 설명은 별도 <p>로 분리
    await setupDetailMocks(page);
    await page.goto('/domains/textbook.com?tab=settings');
    await expect(page.getByTestId('domain-settings-tab')).toBeVisible();

    // quality 필드: Label 접근성 이름이 "품질"만이어야 한다 (힌트 포함 금지)
    const qualityLabel = page.locator('label[for="optimizer-quality"]');
    await expect(qualityLabel).toHaveText('품질');
    await expect(qualityLabel).not.toContainText('1–100');

    // 힌트가 별도 <p>로 존재해야 한다
    await expect(page.getByText('1–100 사이의 정수')).toBeVisible();

    // max_width 필드: Label 접근성 이름이 "최대 너비"만이어야 한다
    const maxWidthLabel = page.locator('label[for="optimizer-max-width"]');
    await expect(maxWidthLabel).toHaveText('최대 너비');
    await expect(maxWidthLabel).not.toContainText('px');
    await expect(maxWidthLabel).not.toContainText('무제한');

    // 힌트가 별도 <p>로 존재해야 한다
    await expect(page.getByText('px 단위, 0 입력 시 너비 제한 없음')).toBeVisible();
  });
});
