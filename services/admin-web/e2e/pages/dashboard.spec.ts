/// 대시보드 페이지 E2E 테스트
/// API 모킹으로 프록시 상태 카드와 요청 로그 테이블의 렌더링을 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import {
  createProxyStatusOnline,
  createProxyStatusOffline,
  createRequestLogs,
} from '../factories/proxy.factory';
import { createCacheStats, createCacheSeriesBuckets } from '../factories/cache.factory';

/** 스택 차트가 로딩 상태로 멈추지 않도록 /cache/series를 모킹한다 */
async function mockCacheSeries(page: import('@playwright/test').Page) {
  await page.route('**/api/cache/series*', (route) =>
    route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
  );
}

test.describe('대시보드 — 프록시 상태 카드', () => {
  test('프록시 온라인 시 초록 배지, 업타임, 요청 수가 표시된다', async ({ page }) => {
    // API 모킹: 온라인 상태 (업타임 3600초 = 1시간 0분, 요청 수 42)
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 온라인 배지 확인
    await expect(page.getByText('온라인')).toBeVisible();

    // 업타임 "1시간 0분" 표시 확인 — 차트 축 레이블 충돌 방지 위해 testid 로 스코프
    await expect(page.getByTestId('proxy-uptime')).toHaveText('1시간 0분');

    // 총 요청 수 표시 확인
    await expect(page.getByText('총 요청 42건')).toBeVisible();
  });

  test('프록시 오프라인 시 빨간 배지가 표시된다', async ({ page }) => {
    // API 모킹: 오프라인 상태
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOffline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 오프라인 배지 확인
    await expect(page.getByText('오프라인')).toBeVisible();
  });

  test('업타임이 분 단위일 때 올바른 포맷으로 표시된다', async ({ page }) => {
    // API 모킹: 업타임 300초 = 5분
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline({ uptime: 300 }));
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 차트 축 레이블("1시 5분 21초" 등)이 strict-mode 에 매칭되는 이슈 회피 위해 testid 로 스코프
    await expect(page.getByTestId('proxy-uptime')).toHaveText('5분');
  });
});

test.describe('대시보드 — 요청 로그 테이블', () => {
  test('요청 로그 3건이 테이블에 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', createRequestLogs());
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 각 로그의 URL이 테이블에 표시되는지 확인
    await expect(page.getByText('/get')).toBeVisible();
    await expect(page.getByText('/data')).toBeVisible();
    await expect(page.getByText('/img.png')).toBeVisible();

    // 호스트명 확인
    await expect(page.getByText('httpbin.org')).toBeVisible();
    await expect(page.getByText('api.test.com')).toBeVisible();
    await expect(page.getByText('cdn.test.com')).toBeVisible();

    // 상태코드 확인
    await expect(page.getByText('200')).toBeVisible();
    await expect(page.getByText('201')).toBeVisible();
    await expect(page.getByText('404')).toBeVisible();

    // 응답시간 확인
    await expect(page.getByText('150ms')).toBeVisible();
    await expect(page.getByText('80ms')).toBeVisible();
    await expect(page.getByText('30ms')).toBeVisible();
  });

  test('요청 로그가 없을 때 안내 메시지가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 빈 상태 안내 문구 확인
    await expect(page.getByText('요청 로그가 없습니다')).toBeVisible();
  });
});

test.describe('대시보드 — 빈 상태 카드 (#123)', () => {
  /// ByDomainTable / PopularContentCard 빈 상태 회귀 테스트
  /// by_domain=[] 와 /cache/popular=[] 모킹으로 아이콘·설명이 표시되는지 검증한다

  test('도메인 데이터 없을 때 ByDomainTable에 아이콘과 안내 문구가 표시된다', async ({ page }) => {
    // by_domain 빈 배열로 모킹 — 텍스트만 표시되던 버그(#123) 재현 조건
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({ by_domain: [] }));
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );

    await page.goto('/');

    // 아이콘 포함 빈 상태 영역이 렌더링되는지 확인 (Globe 아이콘은 aria-hidden이므로 텍스트로 검증)
    await expect(page.getByText('도메인 데이터가 없습니다')).toBeVisible();
    await expect(page.getByText('도메인을 추가하면 캐시 지표가 표시됩니다')).toBeVisible();
  });

  test('캐시 콘텐츠 없을 때 PopularContentCard에 아이콘과 안내 문구가 표시된다', async ({ page }) => {
    // /cache/popular 빈 배열로 모킹 — 텍스트만 표시되던 버그(#123) 재현 조건
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({ by_domain: [] }));
    await mockApi(page, 'GET', '/cache/popular', []);
    await page.route('**/api/cache/series*', (route) =>
      route.fulfill({ json: { buckets: createCacheSeriesBuckets() } }),
    );

    await page.goto('/');

    // 아이콘 포함 빈 상태 영역이 렌더링되는지 확인
    await expect(page.getByText('캐시된 콘텐츠가 없습니다')).toBeVisible();
    await expect(page.getByText('프록시로 요청이 들어오면 자동으로 표시됩니다')).toBeVisible();
  });
});

test.describe('대시보드 — 로딩 상태', () => {
  test('API 응답 전 로딩 인디케이터가 표시된다', async ({ page }) => {
    // API 모킹: 1초 지연
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline(), { delay: 1000 });
    await mockApi(page, 'GET', '/proxy/requests', [], { delay: 1000 });
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());
    await mockCacheSeries(page);

    await page.goto('/');

    // 로딩 스켈레톤이 표시되는지 확인
    await expect(page.getByTestId('proxy-status-loading')).toBeVisible();

    // 데이터 로드 후 로딩이 사라지고 실제 데이터가 표시되는지 확인
    await expect(page.getByText('온라인')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('proxy-status-loading')).not.toBeVisible();
  });
});
