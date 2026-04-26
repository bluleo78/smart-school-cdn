import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCertList } from '../factories/tls.factory';

test.describe('시스템 페이지', () => {
  test.beforeEach(async ({ page }) => {
    // admin-server 없이도 안정적으로 동작하도록 goto 전에 모킹
    await mockApi(page, 'GET', '/proxy/status', { online: true, uptime: 3600 });
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 160, l1_hits: 100, l2_hits: 6, miss: 44, bypass_total: 10,
      bypass: { method: 10, nocache: 0, size: 0, other: 0, total: 10 },
      l1_hit_rate: 100 / 160, edge_hit_rate: 106 / 160, bypass_rate: 10 / 160,
      disk: { used_bytes: 500_000_000, max_bytes: 5_000_000_000, entry_count: 42 },
      by_domain: [],
    });
    await page.goto('/system');
  });

  test('시스템 페이지가 렌더링된다', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '시스템' })).toBeVisible();
  });

  test('서버 업타임 섹션이 표시된다', async ({ page }) => {
    await expect(page.getByText('서버 업타임')).toBeVisible();
    await expect(page.getByTestId('uptime-value')).toBeVisible();
  });

  test('디스크 사용량 섹션이 표시된다', async ({ page }) => {
    await expect(page.getByText('캐시 디스크 사용량')).toBeVisible();
    await expect(page.getByTestId('disk-usage-bar')).toBeVisible();
  });
});

test.describe('CA 인증서 섹션', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/system');
  });

  test('CA 인증서 카드가 렌더링된다', async ({ page }) => {
    // ca-cert-card와 두 다운로드 버튼이 모두 노출되어야 한다
    await expect(page.getByTestId('ca-cert-card')).toBeVisible();
    await expect(page.getByTestId('ca-download-btn')).toBeVisible();
    await expect(page.getByTestId('mobileconfig-download-btn')).toBeVisible();
  });

  test('iPad 설치 방법 안내가 표시된다', async ({ page }) => {
    await expect(page.getByText('iPad 설치 방법')).toBeVisible();
  });
});

test.describe('발급된 인증서 목록', () => {
  test('인증서가 있을 때 테이블이 렌더링된다', async ({ page }) => {
    // /tls/certificates를 인증서 목록으로 모킹
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    // fetch 완료 전 로딩 상태 → fetch 후 테이블로 전환
    await expect(page.getByTestId('certificates-table')).toBeVisible({ timeout: 10000 });
  });

  test('인증서가 없을 때 빈 상태 메시지가 표시된다', async ({ page }) => {
    // 빈 배열로 모킹 — 빈 상태 p 태그가 노출되어야 한다
    await mockApi(page, 'GET', '/tls/certificates', []);
    await page.goto('/system');

    await expect(page.getByTestId('certificates-empty')).toBeVisible({ timeout: 10000 });
  });

  test('유효 인증서에 유효 배지가 표시된다', async ({ page }) => {
    // textbook.co.kr 행은 60일 후 만료 → 유효 배지 (TlsStatusBadge: >30일)
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'textbook.co.kr' });
    await expect(row.getByText('유효')).toBeVisible({ timeout: 10000 });
  });

  test('만료 임박 인증서에 만료 N일 전 배지가 표시된다', async ({ page }) => {
    // cdn.edunet.net 행은 3일 후 만료 → 만료 3일 전 배지 (TlsStatusBadge: 1~30일)
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'cdn.edunet.net' });
    await expect(row.getByText(/만료 \d+일 전/)).toBeVisible({ timeout: 10000 });
  });

  test('만료 인증서에 만료됨 배지가 표시된다', async ({ page }) => {
    // expired.test 행은 이미 만료 → 만료됨 배지 (TlsStatusBadge: ≤0일)
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'expired.test' });
    await expect(row.getByText('만료됨')).toBeVisible({ timeout: 10000 });
  });

  // 30초마다 자동 갱신: useTls 훅의 refetchInterval: 30_000 옵션으로 구현됨.
  // E2E에서 타이머 기반 폴링을 직접 검증하는 것은 신뢰성이 낮으므로 생략한다.
});

/// 서비스 상태 그리드 — Phase 6 마이크로서비스 헬스체크 UI
/// 커버리지:
///   정상 렌더링  ✅
///   오프라인 상태 ✅
///   장애 배너    ✅
test.describe('서비스 상태 그리드', () => {
  const allOnlineStatus = {
    proxy:     { online: true,  latency_ms: 12 },
    storage:   { online: true,  latency_ms: 3  },
    tls:       { online: true,  latency_ms: 5  },
    dns:       { online: true,  latency_ms: 2  },
    optimizer: { online: true,  latency_ms: 8  },
  };

  test('5개 서비스 카드가 모두 렌더링된다', async ({ page }) => {
    await mockApi(page, 'GET', '/system/status', allOnlineStatus);
    await page.goto('/system');

    const cards = page.getByTestId('service-status-card');
    await expect(cards).toHaveCount(5);
  });

  test('모든 서비스 온라인일 때 온라인 배지가 5개 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/system/status', allOnlineStatus);
    await page.goto('/system');

    // 온라인 배지 텍스트 확인
    const badges = page.getByTestId('service-status-badge');
    await expect(badges).toHaveCount(5);
    for (const badge of await badges.all()) {
      await expect(badge).toHaveText('온라인');
    }
  });

  test('온라인 서비스는 응답시간(ms)을 표시한다', async ({ page }) => {
    await mockApi(page, 'GET', '/system/status', allOnlineStatus);
    await page.goto('/system');

    // 응답시간 형식 검증 (숫자ms 형태)
    const latencies = page.getByTestId('service-status-latency');
    await expect(latencies).toHaveCount(5);
    const texts = await latencies.allTextContents();
    for (const text of texts) {
      expect(text).toMatch(/^\d+ms$/);
    }
  });

  test('일부 서비스 오프라인일 때 오프라인 배지가 표시된다', async ({ page }) => {
    const partialOffline = {
      ...allOnlineStatus,
      storage: { online: false, latency_ms: -1 },
    };
    await mockApi(page, 'GET', '/system/status', partialOffline);
    await page.goto('/system');

    // 오프라인 배지는 1개
    const offlineBadges = page.getByTestId('service-status-badge').filter({ hasText: '오프라인' });
    await expect(offlineBadges).toHaveCount(1);
  });

  test('오프라인 서비스는 응답시간 대신 대시(—)를 표시한다', async ({ page }) => {
    const partialOffline = {
      ...allOnlineStatus,
      dns: { online: false, latency_ms: -1 },
    };
    await mockApi(page, 'GET', '/system/status', partialOffline);
    await page.goto('/system');

    // 오프라인 서비스 카드가 렌더링될 때까지 대기한 뒤 텍스트 수집
    const latencies = page.getByTestId('service-status-latency');
    await expect(latencies).toHaveCount(5, { timeout: 10000 });
    const texts = await latencies.allTextContents();
    // 최소 1개는 대시 (dns: online=false → —)
    expect(texts.some(t => t === '—')).toBe(true);
  });

  test('서비스 장애 시 오프라인 배너가 표시된다', async ({ page }) => {
    const offlineStatus = {
      ...allOnlineStatus,
      storage: { online: false, latency_ms: -1 },
    };
    await mockApi(page, 'GET', '/system/status', offlineStatus);
    await page.goto('/system');

    await expect(page.getByTestId('service-offline-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('일부 서비스가 오프라인입니다.')).toBeVisible();
  });

  test('모든 서비스 온라인일 때 장애 배너가 없다', async ({ page }) => {
    await mockApi(page, 'GET', '/system/status', allOnlineStatus);
    await page.goto('/system');

    // 배너가 없는 경우 — 렌더링되지 않아야 함
    await expect(page.getByTestId('service-offline-banner')).not.toBeVisible();
  });
});

/// LogViewer — Phase 8-3 실시간 로그 뷰어 통합 테스트
/// 커버리지:
///   카드 렌더링               ✅
///   서비스 셀렉트             ✅
///   레벨 셀렉트               ✅
///   지우기 버튼               ✅
///   자동 스크롤 aria-pressed  ✅ (#62)
test.describe('LogViewer', () => {
  /** SSE mock 설정 헬퍼 — 1줄 로그를 포함한 스트림 반환 */
  async function mockSse(page: import('@playwright/test').Page, withLine = false) {
    await page.route('**/api/logs/**', async (route) => {
      const body = withLine
        ? `data: ${JSON.stringify({
            timestamp: '2026-04-14T10:00:00.000Z',
            level: 'INFO',
            message: 'cache HIT host=example.com',
            service: 'proxy',
          })}\n\n`
        : '';
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body,
      });
    });
  }

  test.beforeEach(async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', { online: true, uptime: 3600 });
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 160, l1_hits: 100, l2_hits: 6, miss: 44,
      bypass: { method: 10, nocache: 0, size: 0, other: 0, total: 10 },
      l1_hit_rate: 100 / 160, edge_hit_rate: 106 / 160, bypass_rate: 10 / 160,
      disk: { used_bytes: 500_000_000, max_bytes: 5_000_000_000, entry_count: 42 },
      by_domain: [],
    });
  });

  test('LogViewer 카드가 표시된다', async ({ page }) => {
    await mockSse(page);
    await page.goto('/system');

    await expect(page.getByTestId('log-viewer')).toBeVisible();
  });

  test('서비스 선택 셀렉트가 표시된다', async ({ page }) => {
    await mockSse(page);
    await page.goto('/system');

    await expect(page.getByTestId('log-service-select')).toBeVisible();
  });

  test('레벨 필터 셀렉트가 표시된다', async ({ page }) => {
    await mockSse(page);
    await page.goto('/system');

    await expect(page.getByTestId('log-level-select')).toBeVisible();
  });

  test('지우기 버튼을 클릭하면 로그가 비워진다', async ({ page }) => {
    await mockSse(page, true);
    await page.goto('/system');

    // SSE 데이터(로그 줄)가 도착할 때까지 대기
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('cache HIT'),
    );

    await page.getByTestId('log-clear-btn').click();

    await expect(page.getByTestId('log-empty')).toBeVisible();
  });

  test('자동 스크롤 버튼에 aria-pressed 속성이 반영된다 — 회귀 방지 #62', async ({ page }) => {
    // aria-pressed 없으면 스크린리더가 토글 상태 인식 불가 — #62 버그 수정 회귀 방지
    await mockSse(page);
    await page.goto('/system');

    const btn = page.getByTestId('log-autoscroll-btn');
    await expect(btn).toBeVisible();

    // 초기 상태: autoScroll=true → aria-pressed="true"
    await expect(btn).toHaveAttribute('aria-pressed', 'true');

    // 클릭 후: autoScroll=false → aria-pressed="false"
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    // 재클릭: autoScroll=true → aria-pressed="true"
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('로그 메시지에 ANSI escape code가 표시되지 않는다 — 회귀 방지 #18', async ({ page }) => {
    // ESC 문자(0x1b)를 리터럴 대신 fromCharCode로 생성 — no-control-regex lint 규칙 준수
    const ESC = String.fromCharCode(27);
    // Rust 서비스 컬러 출력 형태의 ANSI code가 포함된 메시지를 SSE로 전달
    await page.route('**/api/logs/**', async (route) => {
      const body = `data: ${JSON.stringify({
        timestamp: '2026-04-26T10:00:00.000Z',
        level: 'WARN',
        message: `${ESC}[2m2026-04-26T10:00:00Z${ESC}[0m ${ESC}[33m WARN${ESC}[0m ${ESC}[2mproxy::clients${ESC}[0m: admin snapshot 실패`,
        service: 'proxy',
      })}\n\n`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body,
      });
    });
    await page.goto('/system');

    // 로그 줄이 렌더링될 때까지 대기
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('admin snapshot 실패'),
    );

    // ANSI escape code(ESC[ 시퀀스)가 DOM 텍스트에 노출되지 않아야 한다
    const scrollAreaText = await page.getByTestId('log-scroll-area').textContent();
    const ansiPattern = new RegExp(`${ESC}\\[`);
    expect(scrollAreaText).not.toMatch(ansiPattern);
    expect(scrollAreaText).toContain('admin snapshot 실패');
  });
});
