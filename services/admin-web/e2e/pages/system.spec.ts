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

  /// 회귀 방지 #157: /cache 링크가 /domains로 리다이렉트되는 데드 링크 — 대시보드(/)로 수정
  /// diskUsageRatio >= 0.9 일 때 경고 배너의 "캐시 관리 페이지로 이동" 링크가 /를 가리켜야 한다
  test('디스크 경고 배너 "캐시 관리 페이지로 이동" 링크가 / (대시보드)를 가리킨다 — 회귀 방지 #157', async ({ page }) => {
    // used_bytes(900GB) / max_bytes(1TB) = 90% → isDiskWarning = true
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 1000, l1_hits: 900, l2_hits: 10, miss: 90, bypass_total: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0.9, edge_hit_rate: 0.91, bypass_rate: 0,
      disk: { used_bytes: 966_367_641_600, max_bytes: 1_073_741_824_000, entry_count: 500 },
      by_domain: [],
    });
    await page.goto('/system');

    // 경고 배너가 표시될 때까지 대기
    const link = page.getByRole('link', { name: '캐시 관리 페이지로 이동' });
    await expect(link).toBeVisible({ timeout: 10000 });

    // href가 / (대시보드) 이어야 한다 (/cache 또는 /domains 금지)
    await expect(link).toHaveAttribute('href', '/');
  });

  /// 회귀 방지 #204: 99.5%~99.99% 구간이 Math.round로 100%로 misleading 표시되던 버그
  /// used < max 인 한 표시값은 99% 이하여야 하고, "100% 사용 중" 텍스트가 노출되어선 안 된다.
  test('used < max 일 때 "100% 사용 중"으로 misleading 표시되지 않는다 — 회귀 방지 #204', async ({ page }) => {
    // 99.5GB / 100GB = 99.5% — Math.round 시 100, Math.floor + 99 cap 시 99로 표시되어야 한다
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 0, l1_hits: 0, l2_hits: 0, miss: 0, bypass_total: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0, edge_hit_rate: 0, bypass_rate: 0,
      disk: { used_bytes: 99_500_000_000, max_bytes: 100_000_000_000, entry_count: 0 },
      by_domain: [],
    });
    await page.goto('/system');

    // "99% 사용 중"이 보여야 하고, "100% 사용 중"은 보여서는 안 된다 (used < max인데 100% 오표시)
    await expect(page.getByText('99% 사용 중')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('100% 사용 중')).toHaveCount(0);

    // 경고 배너도 동일 변수 참조 — 99% 표시 (100%로 misleading 금지)
    await expect(page.getByText('캐시 디스크 사용량이 99%입니다.')).toBeVisible();
    await expect(page.getByText('캐시 디스크 사용량이 100%입니다.')).toHaveCount(0);

    // bar width도 99로 설정되어야 한다
    const barWidth = await page.getByTestId('disk-usage-bar').locator('div').first().evaluate(
      (el) => parseFloat((el as HTMLElement).style.width),
    );
    expect(barWidth).toBe(99);
  });

  /// 회귀 방지 #239: SystemPage가 GB 고정 단위로 표시해 Dashboard(formatBytes 적응형)와 단위 불일치
  /// 같은 캐시 통계 값을 두 페이지에서 동일한 단위 정책(B/KB/MB/GB 적응형)으로 표시해야 한다.
  test('디스크 사용량이 formatBytes 적응형 단위로 표시된다 — 회귀 방지 #239', async ({ page }) => {
    // 50 MB used, 5 GB max — formatBytes는 "50.0 MB" / "5.0 GB"로 표시해야 한다 (GB 고정 시 "0.0 GB"로 오표시)
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 0, l1_hits: 0, l2_hits: 0, miss: 0, bypass_total: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0, edge_hit_rate: 0, bypass_rate: 0,
      disk: { used_bytes: 50 * 1024 * 1024, max_bytes: 5 * 1024 * 1024 * 1024, entry_count: 10 },
      by_domain: [],
    });
    await page.goto('/system');

    // 적응형 단위로 표시: used는 MB, max는 GB
    await expect(page.getByText('50.0 MB 사용')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('5.0 GB 최대')).toBeVisible();
    // GB 고정 표기("0.0 GB 사용")가 더 이상 노출되지 않아야 한다
    await expect(page.getByText('0.0 GB 사용')).toHaveCount(0);
  });

  /// 회귀 방지 #140: diskUsagePercent 100% clamp 없어 progress bar overflow 가능
  /// used_bytes > max_bytes 시 bar width가 100%를 초과하지 않아야 한다
  test('used_bytes > max_bytes 이어도 progress bar width가 100% 이하다 — 회귀 방지 #140', async ({ page }) => {
    // used_bytes(6GB) > max_bytes(5GB) 로 의도적 overflow 조건 설정
    await mockApi(page, 'GET', '/cache/stats', {
      requests: 0, l1_hits: 0, l2_hits: 0, miss: 0, bypass_total: 0,
      bypass: { method: 0, nocache: 0, size: 0, other: 0, total: 0 },
      l1_hit_rate: 0, edge_hit_rate: 0, bypass_rate: 0,
      disk: { used_bytes: 6_000_000_000, max_bytes: 5_000_000_000, entry_count: 0 },
      by_domain: [],
    });
    await page.goto('/system');

    await expect(page.getByTestId('disk-usage-bar')).toBeVisible();

    // bar 내부 div의 width 스타일 값이 100%를 초과하지 않아야 한다
    const barWidth = await page.getByTestId('disk-usage-bar').locator('div').first().evaluate(
      (el) => parseFloat((el as HTMLElement).style.width),
    );
    expect(barWidth).toBeLessThanOrEqual(100);

    // 텍스트 표시도 100%여야 한다 (clamp 결과)
    await expect(page.getByText(/100% 사용 중/)).toBeVisible();
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

  /// 회귀 방지 #187: CA/모바일프로파일 다운로드 실패 시 토스트 등 피드백 없음
  /// 5xx 응답을 모킹해 mutation onError 토스트가 노출되는지 검증한다.
  test('CA 인증서 다운로드 실패 시 토스트가 표시된다 — 회귀 방지 #187', async ({ page }) => {
    await page.route('**/api/tls/ca', (route) =>
      route.fulfill({ status: 500, body: 'fail' }),
    );
    await page.goto('/system');

    await page.getByTestId('ca-download-btn').click();

    await expect(
      page.getByText('CA 인증서 다운로드에 실패했습니다.'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('iOS 프로파일 다운로드 실패 시 토스트가 표시된다 — 회귀 방지 #187', async ({ page }) => {
    await page.route('**/api/tls/ca/mobileconfig', (route) =>
      route.fulfill({ status: 500, body: 'fail' }),
    );
    await page.goto('/system');

    await page.getByTestId('mobileconfig-download-btn').click();

    await expect(
      page.getByText('iOS 프로파일 다운로드에 실패했습니다.'),
    ).toBeVisible({ timeout: 5000 });
  });

  /// 회귀 방지 #214: CA/iOS 프로파일 다운로드 성공 시 토스트 부재로 결과 피드백 비대칭
  /// 200 응답을 모킹해 mutation onSuccess 토스트가 노출되는지 검증한다.
  test('CA 인증서 다운로드 성공 시 토스트가 표시된다 — 회귀 방지 #214', async ({ page }) => {
    // Blob 응답이 필요 — downloadCACert는 응답을 Blob으로 처리해 anchor download 트리거
    await page.route('**/api/tls/ca', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/x-x509-ca-cert',
        body: 'fake-cert-bytes',
      }),
    );
    await page.goto('/system');

    await page.getByTestId('ca-download-btn').click();

    await expect(
      page.getByText('CA 인증서를 다운로드했습니다. 다운로드 폴더에서 확인하세요.'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('iOS 프로파일 다운로드 성공 시 토스트가 표시된다 — 회귀 방지 #214', async ({ page }) => {
    await page.route('**/api/tls/ca/mobileconfig', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/x-apple-aspen-config',
        body: 'fake-mobileconfig-bytes',
      }),
    );
    await page.goto('/system');

    await page.getByTestId('mobileconfig-download-btn').click();

    await expect(
      page.getByText('iOS 프로파일을 다운로드했습니다. 설정 앱에서 설치를 계속하세요.'),
    ).toBeVisible({ timeout: 5000 });
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

  test('만료 임박 인증서에 N일 후 만료 배지가 표시된다', async ({ page }) => {
    // cdn.edunet.net 행은 3일 후 만료 → '3일 후 만료' 배지 (TlsStatusBadge: 1~30일)
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'cdn.edunet.net' });
    await expect(row.getByText(/\d+일 후 만료/)).toBeVisible({ timeout: 10000 });
  });

  test('만료 인증서에 만료됨 배지가 표시된다', async ({ page }) => {
    // expired.test 행은 이미 만료 → 만료됨 배지 (TlsStatusBadge: ≤0일)
    await mockApi(page, 'GET', '/tls/certificates', createCertList());
    await page.goto('/system');

    const row = page.locator('tr', { hasText: 'expired.test' });
    await expect(row.getByText('만료됨')).toBeVisible({ timeout: 10000 });
  });

  /// 회귀 방지 #196: 24시간 이내 미래 만료가 '만료됨'으로 잘못 표시되던 경계값 버그
  /// - 1h 미래 → '시간 후 만료' (만료됨이 아니어야 함)
  /// - 23h 미래 → '시간 후 만료' (만료됨이 아니어야 함)
  /// - 25h 미래 → '1일 후 만료' (Math.ceil로 N일 후 만료 분기로 진입)
  /// - 1h 과거 → '만료됨' (정상 동작 유지)
  test('24시간 이내 미래 만료는 시간 단위로 표시된다 — 회귀 방지 #196', async ({ page }) => {
    const now = Date.now();
    const future1h = new Date(now + 1 * 3_600_000).toISOString();
    const future23h = new Date(now + 23 * 3_600_000).toISOString();
    const future25h = new Date(now + 25 * 3_600_000).toISOString();
    const past1h = new Date(now - 1 * 3_600_000).toISOString();
    const issued = new Date(now - 86_400_000).toISOString();
    await mockApi(page, 'GET', '/tls/certificates', [
      { domain: 'future-1h.test', issued_at: issued, expires_at: future1h },
      { domain: 'future-23h.test', issued_at: issued, expires_at: future23h },
      { domain: 'future-25h.test', issued_at: issued, expires_at: future25h },
      { domain: 'past-1h.test', issued_at: issued, expires_at: past1h },
    ]);
    await page.goto('/system');

    // 1h 미래 만료 — '만료됨'이 아니라 'N시간 후 만료'로 표시되어야 한다
    const row1h = page.locator('tr', { hasText: 'future-1h.test' });
    await expect(row1h.getByText(/\d+시간 후 만료/)).toBeVisible({ timeout: 10000 });
    await expect(row1h.getByText('만료됨', { exact: true })).toHaveCount(0);

    // 23h 미래 만료 — '만료됨'이 아니라 'N시간 후 만료'
    const row23h = page.locator('tr', { hasText: 'future-23h.test' });
    await expect(row23h.getByText(/\d+시간 후 만료/)).toBeVisible({ timeout: 10000 });
    await expect(row23h.getByText('만료됨', { exact: true })).toHaveCount(0);

    // 25h 미래 만료 — Math.ceil로 '1일 후 만료'
    const row25h = page.locator('tr', { hasText: 'future-25h.test' });
    await expect(row25h.getByText(/\d+일 후 만료/)).toBeVisible({ timeout: 10000 });

    // 1h 과거 만료 — '만료됨' 정상 표시 (기존 동작 유지)
    const rowPast = page.locator('tr', { hasText: 'past-1h.test' });
    await expect(rowPast.getByText('만료됨', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  // 30초마다 자동 갱신: useTls 훅의 refetchInterval: 30_000 옵션으로 구현됨.
  // E2E에서 타이머 기반 폴링을 직접 검증하는 것은 신뢰성이 낮으므로 생략한다.

  /// 회귀 방지 #210: 인증서 카드가 서버 응답 순서를 그대로 렌더해 만료/임박 인증서가
  /// 정상 인증서 사이에 섞이는 버그. 클라이언트에서 expires_at 오름차순 정렬해야 한다.
  /// — 만료(과거) → 임박(가까운 만료) → 일반 순으로 행이 배치되어야 한다
  test('만료/임박 인증서가 상단에 정렬된다 — 회귀 방지 #210', async ({ page }) => {
    const now = Date.now();
    const issued = new Date(now - 86_400_000).toISOString();
    // 의도적으로 정렬되지 않은 순서(정상 → 만료 → 정상 → 임박 → 정상)로 응답
    await mockApi(page, 'GET', '/tls/certificates', [
      { domain: 'normal-a.test', issued_at: issued, expires_at: new Date(now + 60 * 86_400_000).toISOString() },
      { domain: 'expired-old.test', issued_at: issued, expires_at: new Date(now - 10 * 86_400_000).toISOString() },
      { domain: 'normal-b.test', issued_at: issued, expires_at: new Date(now + 90 * 86_400_000).toISOString() },
      { domain: 'expiring-soon.test', issued_at: issued, expires_at: new Date(now + 3 * 86_400_000).toISOString() },
      { domain: 'normal-c.test', issued_at: issued, expires_at: new Date(now + 80 * 86_400_000).toISOString() },
    ]);
    await page.goto('/system');

    await expect(page.getByTestId('certificates-table')).toBeVisible({ timeout: 10000 });

    // tbody의 도메인 순서를 추출 — 만료 → 임박 → 정상(만료일 오름차순) 순이어야 한다
    const domains = await page
      .getByTestId('certificates-table')
      .locator('tbody tr td:first-child')
      .allTextContents();

    expect(domains).toEqual([
      'expired-old.test',     // -10일 (가장 과거 만료)
      'expiring-soon.test',   // +3일 (임박)
      'normal-a.test',        // +60일
      'normal-c.test',        // +80일
      'normal-b.test',        // +90일
    ]);
  });
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

  /// 회귀 방지 #139: 초기 로딩 중 모든 서비스 온라인 오표시
  /// systemStatus=undefined 시 ?? true fallback이 적용되던 버그 — Skeleton으로 대체 후 해결됨
  test('초기 로딩 중에는 Skeleton이 표시되고 온라인 배지가 없다 — 회귀 방지 #139', async ({ page }) => {
    // 500ms 지연으로 로딩 중 상태를 안정적으로 포착
    await mockApi(page, 'GET', '/system/status', allOnlineStatus, { delay: 500 });
    await page.goto('/system');

    // 응답 도착 전: Skeleton 5개가 표시되어야 한다
    const skeletons = page.getByTestId('service-status-skeleton');
    await expect(skeletons).toHaveCount(5);

    // 응답 도착 전: 온라인/오프라인 배지가 표시되어서는 안 된다 (오표시 방지)
    await expect(page.getByTestId('service-status-badge')).toHaveCount(0);

    // 응답 도착 후: 실제 카드로 전환된다
    await expect(page.getByTestId('service-status-card')).toHaveCount(5, { timeout: 5000 });
    await expect(skeletons).toHaveCount(0);
  });

  /// 회귀 방지 #269: 810×1080(iPad portrait)에서 5개 카드가 3-col 그리드로 배치되어
  /// 마지막 행에 빈 슬롯이 생기던 버그. md(768px+)부터 5-col 단일 행으로 정렬되어야 한다.
  test('810×1080에서 5개 카드가 단일 행에 배치된다 — 회귀 방지 #269', async ({ page }) => {
    await page.setViewportSize({ width: 810, height: 1080 });
    await mockApi(page, 'GET', '/system/status', allOnlineStatus);
    await page.goto('/system');

    const cards = page.getByTestId('service-status-card');
    await expect(cards).toHaveCount(5);

    // 모든 카드의 top y 좌표가 동일하면 단일 행으로 배치된 것
    // (3-col 그리드였다면 4번째/5번째 카드는 두 번째 행으로 내려가 y가 달라짐)
    const ys = await cards.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(ys).size).toBe(1);
  });
});

/// LogViewer — Phase 8-3 실시간 로그 뷰어 통합 테스트
/// 커버리지:
///   카드 렌더링               ✅
///   서비스 셀렉트             ✅
///   레벨 셀렉트               ✅
///   지우기 버튼               ✅
///   자동 스크롤 aria-pressed  ✅ (#62)
///   타임스탬프 날짜 표시      ✅ (#75)
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

  test('과거 날짜 타임스탬프는 날짜+시간을 표시한다 — 회귀 방지 #75', async ({ page }) => {
    // 어제 날짜(과거) 타임스탬프를 포함한 로그를 SSE로 전달 — 날짜 경계 구분 기능 회귀 방지
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(21, 16, 51, 0);
    const yesterdayTs = yesterday.toISOString();

    // goto 전에 route 등록 — useLogStream이 마운트되자마자 intercepted
    await page.route('**/api/logs/**', async (route) => {
      const body =
        `data: ${JSON.stringify({ timestamp: yesterdayTs, level: 'INFO', message: '어제 로그', service: 'proxy' })}\n\n`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body,
      });
    });
    await page.goto('/system');

    // 어제 로그 줄이 렌더링될 때까지 대기
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('어제 로그'),
    );

    // ko-KR toLocaleDateString month:'2-digit' day:'2-digit' → "04. 26." 형식
    // 어제 날짜(월/일)가 타임스탬프 텍스트에 포함되어야 한다
    const scrollAreaText = await page.getByTestId('log-scroll-area').textContent() ?? '';
    const yesterdayMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yesterdayDay = String(yesterday.getDate()).padStart(2, '0');
    expect(scrollAreaText).toContain(yesterdayMonth);
    expect(scrollAreaText).toContain(yesterdayDay);
    expect(scrollAreaText).toContain('어제 로그');
  });

  test('서비스/레벨 SelectTrigger에 aria-label이 설정된다 — 회귀 방지 #110', async ({ page }) => {
    // aria-label 없으면 스크린리더가 선택값만 읽고 어떤 필터인지 구분 불가 — #110 버그 수정 회귀 방지
    await mockSse(page);
    await page.goto('/system');

    // 서비스 선택 셀렉트: aria-label="서비스 선택"
    await expect(page.getByTestId('log-service-select')).toHaveAttribute('aria-label', '서비스 선택');
    // 레벨 필터 셀렉트: aria-label="로그 레벨 필터"
    await expect(page.getByTestId('log-level-select')).toHaveAttribute('aria-label', '로그 레벨 필터');
  });

  test('로그 스크롤 영역이 스크롤될 때 scrollTop이 증가한다 — 회귀 방지 #111', async ({ page }) => {
    // refs #111: ScrollArea 내부 overflow-y-auto div 중첩 시 실제 스크롤이 log-scroll-area에서 발생해
    // 스크롤 상태를 올바르게 추적하지 못하는 버그 회귀 방지.
    // 충분한 로그 줄을 주입해 스크롤 영역이 실제로 스크롤되는지 검증한다.
    const manyLines = Array.from({ length: 60 }, (_, i) =>
      `data: ${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `로그 라인 ${i} — 스크롤 회귀 테스트`,
        service: 'proxy',
      })}\n\n`,
    ).join('');

    await page.route('**/api/logs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: manyLines,
      });
    });
    await page.goto('/system');

    // 마지막 로그 줄이 렌더링될 때까지 대기
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('로그 라인 59'),
    );

    // 자동 스크롤에 의해 scrollTop이 0보다 커야 한다 (스크롤 영역 자체가 스크롤됨)
    const scrollTop = await page.getByTestId('log-scroll-area').evaluate(
      (el) => (el as HTMLElement).scrollTop,
    );
    expect(scrollTop).toBeGreaterThan(0);
  });

  test('레벨 필터로 결과가 0줄일 때 "선택한 조건에 해당하는 로그가 없습니다." 가 표시된다 — 회귀 방지 #92', async ({ page }) => {
    // logs가 있어도 필터 결과 없으면 연결 상태 문구(로그를 수신 중입니다...) 대신
    // 필터 안내 문구(선택한 조건에 해당하는 로그가 없습니다.)가 표시되어야 한다
    await page.route('**/api/logs/**', async (route) => {
      // INFO 레벨 로그 1줄 제공 — DEBUG 필터 적용 시 filteredLines=0, lines.length=1
      const body = `data: ${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'proxy 기동 완료',
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

    // INFO 로그 줄이 렌더링될 때까지 대기 — lines.length > 0 상태 확보
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('proxy 기동 완료'),
    );

    // 레벨 필터를 DEBUG로 변경 — INFO 로그만 있으므로 filteredLines=0
    await page.getByTestId('log-level-select').click();
    await page.getByRole('option', { name: 'DEBUG' }).click();

    // 필터 결과 없음 안내 문구가 표시되어야 한다 (연결 상태 문구 금지)
    await expect(page.getByTestId('log-empty')).toBeVisible();
    await expect(page.getByTestId('log-empty')).toHaveText('선택한 조건에 해당하는 로그가 없습니다.');
    await expect(page.getByTestId('log-empty')).not.toHaveText('로그를 수신 중입니다...');
    await expect(page.getByTestId('log-empty')).not.toHaveText('연결 대기 중...');
  });

  test('OFF 상태에서 레벨 필터로 줄 수가 줄어도 자동 스크롤이 다시 켜지지 않는다 — 회귀 방지 #235', async ({ page }) => {
    // #235: 사용자가 명시적으로 자동 스크롤 OFF한 뒤, 레벨 필터로 보이는 줄 수가 줄어 컨테이너
    // scrollHeight가 작아지면 브라우저가 scrollTop을 자동 클램프하면서 scroll 이벤트가 발생하고
    // atBottom 판정 결과 autoScroll이 다시 ON으로 자동 복귀하던 버그를 방지한다.
    // 충분한 줄 수의 INFO 로그(>스크롤 영역 높이)와 ERROR 0건을 제공해 필터 적용 시 0건이 되도록 한다.
    const manyInfo = Array.from({ length: 60 }, (_, i) =>
      `data: ${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `INFO 로그 ${i} — 자동 스크롤 의도 보존 회귀`,
        service: 'proxy',
      })}\n\n`,
    ).join('');

    await page.route('**/api/logs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: manyInfo,
      });
    });
    await page.goto('/system');

    // 마지막 줄까지 렌더링되어 scrollHeight > clientHeight 보장
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="log-scroll-area"]')?.textContent?.includes('INFO 로그 59'),
    );

    // 사용자가 위로 스크롤 — autoScroll OFF로 전환되어야 한다
    await page.getByTestId('log-scroll-area').evaluate((el) => {
      (el as HTMLElement).scrollTop = 100;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const btn = page.getByTestId('log-autoscroll-btn');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    // 레벨 필터를 ERROR로 변경 — INFO만 있으므로 filteredLines=0, scrollHeight 축소
    await page.getByTestId('log-level-select').click();
    await page.getByRole('option', { name: 'ERROR' }).click();

    // 핵심 검증: 사용자가 끈 자동 스크롤이 ON으로 자동 복귀하면 안 된다
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveText('자동 스크롤 OFF');
  });
});
