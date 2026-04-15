/// 핵심 플로우 E2E 시나리오
/// 도메인 추가 → 캐시 확인 → 도메인 퍼지 → 통계 확인의 전체 사용자 여정을 검증한다.
/// 여러 페이지를 순서대로 이동하며 시스템의 핵심 워크플로우를 단일 테스트로 커버한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCacheStats, createPopularContent } from '../factories/cache.factory';
import { createProxyStatusOnline } from '../factories/proxy.factory';

const DOMAIN = 'textbook.co.kr';
const ORIGIN = 'https://textbook.co.kr';

/** 도메인에 콘텐츠가 캐싱된 상태의 통계 (42건) */
function createCacheStatsWithDomain() {
  return createCacheStats({
    entry_count: 42,
    hit_count: 30,
    miss_count: 12,
    hit_rate: 71.4,
    total_size_bytes: 10_000_000,
    by_domain: [{ domain: DOMAIN, hit_count: 30, size_bytes: 10_000_000 }],
  });
}

test.describe('핵심 플로우 시나리오', () => {
  test('도메인 추가 → 캐시 확인 → 퍼지 → 통계 확인', async ({ page }) => {
    // ─── 1단계: 공통 API 초기 모킹 ───────────────────────────────────
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({ entry_count: 0, total_size_bytes: 0 }));
    await mockApi(page, 'GET', '/cache/popular', []);

    // ─── 2단계: 도메인 추가 ─────────────────────────────────────────
    await mockApi(page, 'GET', '/domains/summary', {
      total: 0, enabled: 0, disabled: 0,
      todayRequests: 0, todayRequestsDelta: 0,
      cacheHitRate: 0, cacheHitRateDelta: 0,
      todayBandwidth: 0,
      hourlyRequests: Array(24).fill(0),
      hourlyCacheHitRate: Array(24).fill(0),
      hourlyBandwidth: Array(24).fill(0),
      alerts: [],
    });
    await mockApi(page, 'GET', '/domains', []);
    const newDomain = {
      host: DOMAIN, origin: ORIGIN,
      enabled: 1, description: '',
      created_at: 1_700_000_000, updated_at: 1_700_000_000,
    };
    await mockApi(page, 'POST', '/domains', newDomain);

    await page.goto('/domains');
    await expect(page.getByTestId('domains-empty')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('toolbar-add-btn').click();
    await page.getByTestId('add-domain-host').fill(DOMAIN);
    await page.getByTestId('add-domain-origin').fill(ORIGIN);

    // 제출 전에 목록 재조회용 모킹 등록 (TanStack Query invalidation 대응)
    await mockApi(page, 'GET', '/domains', [newDomain]);
    await page.getByTestId('add-domain-submit').click();

    // 추가한 도메인이 목록 테이블에 나타나는지 확인
    await expect(page.getByTestId(`domain-row-${DOMAIN}`)).toBeVisible({ timeout: 10000 });

    // ─── 3단계: 캐시 페이지에서 캐시 항목 확인 ─────────────────────
    // 도메인에 콘텐츠가 축적된 상태로 캐시 통계 갱신
    await mockApi(page, 'GET', '/cache/stats', createCacheStatsWithDomain());
    await mockApi(page, 'GET', '/cache/popular', createPopularContent());

    await page.goto('/cache');

    // 42건 캐시 항목과 도메인별 통계 표시 확인
    await expect(page.getByText('42')).toBeVisible({ timeout: 10000 });

    // ─── 4단계: 도메인 퍼지 실행 ────────────────────────────────────
    await mockApi(page, 'DELETE', '/cache/purge', { purged_count: 42, freed_bytes: 10_000_000 });

    await page.getByText('도메인 퍼지').click();
    await page.getByTestId('domain-input').fill(DOMAIN);
    await page.getByTestId('purge-btn').click();

    // 퍼지 확인 다이얼로그에 도메인명이 표시되는지 확인
    await expect(page.getByText(`"${DOMAIN}" 도메인 캐시를 모두 삭제합니다`, { exact: false })).toBeVisible();
    await page.getByTestId('confirm-purge-btn').click();

    // ─── 5단계: 퍼지 완료 및 통계 확인 ─────────────────────────────
    // 퍼지 완료 토스트에 삭제 건수가 표시되는지 확인
    await expect(page.getByTestId('purge-toast')).toContainText('퍼지 완료');
    await expect(page.getByTestId('purge-toast')).toContainText('42건 삭제');
  });
});
