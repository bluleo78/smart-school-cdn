import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCertList } from '../factories/tls.factory';

test.describe('시스템 페이지', () => {
  test.beforeEach(async ({ page }) => {
    // admin-server 없이도 안정적으로 동작하도록 goto 전에 모킹
    await mockApi(page, 'GET', '/proxy/status', { online: true, uptime: 3600 });
    await mockApi(page, 'GET', '/cache/stats', {
      total_size_bytes: 500_000_000,
      max_size_bytes: 5_000_000_000,
      hit_count: 100, miss_count: 50, bypass_count: 10,
      hit_rate: 66.7, entry_count: 42, by_domain: [], hit_rate_history: [],
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

  test('활성 인증서에 활성 배지가 표시된다', async ({ page }) => {
    // textbook.co.kr 행은 30일 후 만료 → 활성 배지
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'textbook.co.kr' });
    await expect(row.getByText('활성')).toBeVisible({ timeout: 10000 });
  });

  test('경고 인증서에 경고 배지가 표시된다', async ({ page }) => {
    // cdn.edunet.net 행은 3일 후 만료 → 경고 배지
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'cdn.edunet.net' });
    await expect(row.getByText('경고')).toBeVisible({ timeout: 10000 });
  });

  test('만료 인증서에 만료 배지가 표시된다', async ({ page }) => {
    // expired.test 행은 이미 만료 → 만료 배지
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'expired.test' });
    await expect(row.getByText('만료')).toBeVisible({ timeout: 10000 });
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

    const latencies = page.getByTestId('service-status-latency');
    const texts = await latencies.allTextContents();
    // 최소 1개는 대시
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
