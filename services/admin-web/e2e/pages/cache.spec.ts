/// 캐시 기능 E2E 테스트 — 대시보드 캐시 카드 + 캐시 관리 페이지 전체 검증
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createPopularContent } from '../factories/cache.factory';
import { createProxyStatusOnline } from '../factories/proxy.factory';

// ─── 공통 헬퍼 ───────────────────────────────────────────────────
/** 대시보드 공통 API 모킹 */
async function mockDashboardApis(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/cache/stats', createCacheStats());
}

// ─── 대시보드 캐시 카드 ────────────────────────────────────────
test.describe('대시보드 — 캐시 히트율 카드', () => {
  test('히트율 퍼센트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-card')).toBeVisible();
    await expect(page.getByText('73.2%')).toBeVisible();
  });

  test('HIT/MISS 카운트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // HIT 750, MISS 274
    await expect(page.getByText('HIT 750')).toBeVisible();
    await expect(page.getByText('MISS 274')).toBeVisible();
  });

  test('로딩 중 스켈레톤이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats(), { delay: 1000 });
    await page.goto('/');
    await expect(page.getByTestId('cache-hit-rate-loading')).toBeVisible();
    await expect(page.getByText('73.2%')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('대시보드 — 스토리지 사용량 카드', () => {
  test('사용량 수치와 프로그레스 바가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByTestId('storage-usage-card')).toBeVisible();
    await expect(page.getByTestId('storage-bar')).toBeVisible();
    // 4_509_715_456 bytes = 4.2 GB
    await expect(page.getByText('4.2 GB', { exact: false })).toBeVisible();
  });

  test('사용률 퍼센트가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // 4509715456 / 21474836480 * 100 ≈ 21.0%
    await expect(page.getByText('21.0%', { exact: false })).toBeVisible();
  });
});

test.describe('대시보드 — 대역폭 절감 카드', () => {
  test('"대역폭 절감" 제목이 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    await expect(page.getByText('대역폭 절감')).toBeVisible();
  });

  test('절감량이 사람이 읽기 좋은 단위로 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // by_domain size_bytes = 3_000_000_000 → 2.8 GB
    await expect(page.getByText('2.8 GB')).toBeVisible();
  });
});

test.describe('대시보드 — 캐시 항목 수 카드', () => {
  test('항목 수가 표시된다', async ({ page }) => {
    await mockDashboardApis(page);
    await page.goto('/');
    // entry_count: 3842 → "3,842"
    await expect(page.getByText('3,842')).toBeVisible();
    await expect(page.getByText('저장된 URL')).toBeVisible();
  });
});

// ─── 캐시 관리 페이지 ─────────────────────────────────────────
test.describe('캐시 관리 페이지 — 통계 카드', () => {
  test('3개 통계 카드(항목수/사용량/히트율)가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');
    await expect(page.getByText('총 캐시 항목')).toBeVisible();
    await expect(page.getByText('사용량')).toBeVisible();
    await expect(page.getByText('히트율')).toBeVisible();
    await expect(page.getByText('3,842')).toBeVisible();
  });
});

test.describe('캐시 관리 페이지 — URL 퍼지', () => {
  test('URL 입력이 비어있으면 퍼지 버튼이 비활성화된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');
    await expect(page.getByTestId('purge-btn')).toBeDisabled();
  });

  test('URL 입력 후 퍼지 버튼이 활성화된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');
    await page.getByTestId('url-input').fill('https://example.com/file');
    await expect(page.getByTestId('purge-btn')).toBeEnabled();
  });

  test('URL 퍼지 전체 플로우 — 입력 → 다이얼로그 → 완료 Toast', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 1, freed_bytes: 2097152 });
    await page.goto('/cache');

    await page.getByTestId('url-input').fill('https://cdn.textbook.com/images/cover.png');
    await page.getByTestId('purge-btn').click();

    // 다이얼로그에 URL이 표시됨
    await expect(page.getByTestId('confirm-purge-btn')).toBeVisible();
    await expect(page.getByText('"https://cdn.textbook.com/images/cover.png" 캐시를 삭제합니다', { exact: false })).toBeVisible();

    await page.getByTestId('confirm-purge-btn').click();

    await expect(page.getByTestId('purge-toast')).toBeVisible();
    await expect(page.getByTestId('purge-toast')).toContainText('퍼지 완료');
    await expect(page.getByTestId('purge-toast')).toContainText('1건 삭제');
  });

  test('확인 다이얼로그에서 취소 클릭 시 다이얼로그가 닫히고 Toast가 없다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');

    await page.getByTestId('url-input').fill('https://example.com/file');
    await page.getByTestId('purge-btn').click();
    await expect(page.getByTestId('confirm-purge-btn')).toBeVisible();

    // 취소
    await page.getByText('취소').click();

    await expect(page.getByTestId('confirm-purge-btn')).not.toBeVisible();
    await expect(page.getByTestId('purge-toast')).not.toBeVisible();
  });

  test('퍼지 API 실패 시 에러 Toast가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await mockApi(page, 'DELETE', '/cache/purge', { error: 'internal server error' }, { status: 500 });
    await page.goto('/cache');

    await page.getByTestId('url-input').fill('https://example.com/file');
    await page.getByTestId('purge-btn').click();
    await page.getByTestId('confirm-purge-btn').click();

    await expect(page.getByTestId('purge-toast')).toBeVisible();
    await expect(page.getByTestId('purge-toast')).toContainText('퍼지 실패');
  });
});

test.describe('캐시 관리 페이지 — 도메인 퍼지', () => {
  test('도메인 탭 클릭 시 도메인 입력란이 나타난다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');

    await page.getByText('도메인 퍼지').click();
    await expect(page.getByTestId('domain-input')).toBeVisible();
  });

  test('도메인 입력이 비어있으면 퍼지 버튼이 비활성화된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');

    await page.getByText('도메인 퍼지').click();
    await expect(page.getByTestId('purge-btn')).toBeDisabled();
  });

  test('도메인 퍼지 전체 플로우 — 입력 → 다이얼로그 → 완료 Toast', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 5, freed_bytes: 10485760 });
    await page.goto('/cache');

    await page.getByText('도메인 퍼지').click();
    await page.getByTestId('domain-input').fill('cdn.textbook.com');
    await page.getByTestId('purge-btn').click();

    await expect(page.getByTestId('confirm-purge-btn')).toBeVisible();
    await expect(page.getByText('"cdn.textbook.com" 도메인 캐시를 모두 삭제합니다', { exact: false })).toBeVisible();

    await page.getByTestId('confirm-purge-btn').click();

    await expect(page.getByTestId('purge-toast')).toContainText('퍼지 완료');
    await expect(page.getByTestId('purge-toast')).toContainText('5건 삭제');
  });
});

test.describe('캐시 관리 페이지 — 전체 퍼지', () => {
  test('전체 퍼지 탭 클릭 시 항목 수가 포함된 안내 문구가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');

    await page.getByText('전체 퍼지').click();
    // entry_count 3842건 안내
    await expect(page.getByText('3,842', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('purge-btn')).toBeEnabled();
  });

  test('전체 퍼지 전체 플로우 — 버튼 → 다이얼로그 → 완료 Toast', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 3842, freed_bytes: 4509715456 });
    await page.goto('/cache');

    await page.getByText('전체 퍼지').click();
    await page.getByTestId('purge-btn').click();

    await expect(page.getByTestId('confirm-purge-btn')).toBeVisible();
    await expect(page.getByText('전체 캐시를 삭제합니다', { exact: false })).toBeVisible();

    await page.getByTestId('confirm-purge-btn').click();

    await expect(page.getByTestId('purge-toast')).toContainText('퍼지 완료');
    await expect(page.getByTestId('purge-toast')).toContainText('3842건 삭제');
  });
});

test.describe('캐시 관리 페이지 — 인기 콘텐츠 테이블', () => {
  test('인기 콘텐츠 테이블이 URL, 크기, 히트수, 도메인을 표시한다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());
    await page.goto('/cache');

    await expect(page.getByText('cover.png', { exact: false })).toBeVisible();
    await expect(page.getByText('chapter1.pdf', { exact: false })).toBeVisible();
    // 크기: 2_097_152 bytes = 2.0 MB
    await expect(page.getByText('2.0 MB')).toBeVisible();
    // 히트 수
    await expect(page.locator('td').filter({ hasText: '412' })).toBeVisible();
    await expect(page.locator('td').filter({ hasText: '387' })).toBeVisible();
    // 도메인
    await expect(page.getByText('cdn.textbook.com').first()).toBeVisible();
  });

  test('캐시된 콘텐츠가 없을 때 빈 상태 메시지가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.goto('/cache');

    await expect(page.getByText('캐시된 콘텐츠가 없습니다')).toBeVisible();
  });
});
