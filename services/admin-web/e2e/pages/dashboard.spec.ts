/// 대시보드 페이지 E2E 테스트
/// API 모킹으로 프록시 상태 카드와 요청 로그 테이블의 렌더링을 검증한다.
import { test, expect } from '@playwright/test';
import { mockApi } from '../fixtures/api-mock';
import {
  createProxyStatusOnline,
  createProxyStatusOffline,
  createRequestLogs,
} from '../factories/proxy.factory';
import { createCacheStats } from '../factories/cache.factory';

test.describe('대시보드 — 프록시 상태 카드', () => {
  test('프록시 온라인 시 초록 배지, 업타임, 요청 수가 표시된다', async ({ page }) => {
    // API 모킹: 온라인 상태 (업타임 3600초 = 1시간 0분, 요청 수 42)
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());

    await page.goto('/');

    // 온라인 배지 확인
    await expect(page.getByText('온라인')).toBeVisible();

    // 업타임 "1시간 0분" 표시 확인
    await expect(page.getByText('1시간 0분')).toBeVisible();

    // 총 요청 수 "42" 표시 확인 (exact: true 로 3,842 등 부분 매칭 방지)
    await expect(page.getByText('42', { exact: true })).toBeVisible();
  });

  test('프록시 오프라인 시 빨간 배지가 표시된다', async ({ page }) => {
    // API 모킹: 오프라인 상태
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOffline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());

    await page.goto('/');

    // 오프라인 배지 확인
    await expect(page.getByText('오프라인')).toBeVisible();
  });

  test('업타임이 분 단위일 때 올바른 포맷으로 표시된다', async ({ page }) => {
    // API 모킹: 업타임 300초 = 5분
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline({ uptime: 300 }));
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());

    await page.goto('/');

    await expect(page.getByText('5분')).toBeVisible();
  });
});

test.describe('대시보드 — 요청 로그 테이블', () => {
  test('요청 로그 3건이 테이블에 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', createRequestLogs());
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());

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

    await page.goto('/');

    // 빈 상태 안내 문구 확인
    await expect(page.getByText('요청 로그가 없습니다')).toBeVisible();
  });
});

test.describe('대시보드 — 로딩 상태', () => {
  test('API 응답 전 로딩 인디케이터가 표시된다', async ({ page }) => {
    // API 모킹: 1초 지연
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline(), { delay: 1000 });
    await mockApi(page, 'GET', '/proxy/requests', [], { delay: 1000 });
    await mockApi(page, 'GET', '/cache/stats', createCacheStats());

    await page.goto('/');

    // 로딩 스켈레톤이 표시되는지 확인
    await expect(page.getByTestId('proxy-status-loading')).toBeVisible();

    // 데이터 로드 후 로딩이 사라지고 실제 데이터가 표시되는지 확인
    await expect(page.getByText('온라인')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('proxy-status-loading')).not.toBeVisible();
  });
});
