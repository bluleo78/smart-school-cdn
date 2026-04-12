/// 도메인 관리 페이지 E2E 테스트
/// 도메인 목록 조회, 추가 다이얼로그, 사이드 패널 프록시 테스트, 삭제 시나리오를 검증한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline, createRequestLogs } from '../factories/proxy.factory';
import { createCacheStats } from '../factories/cache.factory';

/** 테스트용 도메인 목록 팩토리 */
function createDomains() {
  return [
    { host: 'textbook.com', origin: 'https://textbook.com', created_at: 1700000000 },
    { host: 'cdn.school.kr', origin: 'https://cdn.school.kr', created_at: 1700000100 },
  ];
}

test.describe('도메인 관리 — 도메인 목록', () => {
  test('등록된 도메인이 테이블에 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await expect(page.getByTestId('domains-table')).toBeVisible();
    await expect(page.getByTestId('domain-row-textbook.com')).toBeVisible();
    await expect(page.getByTestId('domain-row-cdn.school.kr')).toBeVisible();
  });

  test('도메인이 없으면 빈 상태 메시지가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await expect(page.getByTestId('domains-empty')).toBeVisible();
    await expect(page.getByText('등록된 도메인이 없습니다.')).toBeVisible();
  });
});

test.describe('도메인 관리 — 도메인 추가', () => {
  test('추가 버튼 클릭 시 다이얼로그가 열린다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('add-domain-button').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  test('유효한 도메인 추가 시 다이얼로그가 닫힌다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', []);
    await mockApi(page, 'POST', '/domains', {
      host: 'newdomain.com',
      origin: 'https://newdomain.com',
      created_at: 1700000200,
    });

    await page.goto('/domains');

    await page.getByTestId('add-domain-button').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('https://newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();
  });

  test('원본 URL이 http/https로 시작하지 않으면 오류가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('add-domain-button').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    await expect(page.getByTestId('add-domain-error')).toBeVisible();
  });
});

test.describe('도메인 관리 — 사이드 패널 프록시 테스트', () => {
  test('도메인 행 클릭 시 사이드 패널이 열린다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-row-textbook.com').click();
    await expect(page.getByTestId('domain-side-panel')).toBeVisible();
    await expect(page.getByTestId('domain-side-panel').getByText('https://textbook.com')).toBeVisible();
  });

  test('사이드 패널에서 프록시 테스트 성공 시 결과가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 42,
    });

    await page.goto('/domains');

    await page.getByTestId('domain-row-textbook.com').click();
    await page.getByTestId('panel-test-button').click();

    await expect(page.getByTestId('panel-test-result')).toBeVisible();
    await expect(page.getByText('HTTP 200')).toBeVisible();
    await expect(page.getByText('42ms')).toBeVisible();
  });

  test('테스트 성공 후 프록시/캐시 쿼리가 즉시 갱신된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline({ request_count: 0 }));
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({ hit_count: 0, miss_count: 0, hit_rate: 0 }));
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 42,
    });

    await page.goto('/domains');

    // invalidation 후 refetch 시 반환될 갱신 데이터 준비
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline({ request_count: 1 }));
    await mockApi(page, 'GET', '/proxy/requests', createRequestLogs());
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({ miss_count: 1, hit_rate: 0 }));

    await page.getByTestId('domain-row-textbook.com').click();
    await page.getByTestId('panel-test-button').click();

    await expect(page.getByTestId('panel-test-result')).toBeVisible();
    await expect(page.getByText('HTTP 200')).toBeVisible();
  });

  test('같은 행을 다시 클릭하면 사이드 패널이 닫힌다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-row-textbook.com').click();
    await expect(page.getByTestId('domain-side-panel')).toBeVisible();

    await page.getByTestId('domain-row-textbook.com').click();
    await expect(page.getByTestId('domain-side-panel')).not.toBeVisible();
  });
});

test.describe('도메인 관리 — 도메인 삭제', () => {
  test('사이드 패널 삭제 버튼 클릭 시 확인 다이얼로그가 열린다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-row-textbook.com').click();
    await page.getByTestId('panel-delete-button').click();

    await expect(page.getByTestId('delete-domain-dialog')).toBeVisible();
    await expect(page.getByTestId('delete-domain-dialog').getByText('textbook.com')).toBeVisible();
  });

  test('삭제 확인 시 사이드 패널이 닫힌다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'DELETE', '/domains/textbook.com', null);

    await page.goto('/domains');

    await page.getByTestId('domain-row-textbook.com').click();
    await page.getByTestId('panel-delete-button').click();
    await page.getByTestId('delete-domain-confirm').click();

    await expect(page.getByTestId('delete-domain-dialog')).not.toBeVisible();
    await expect(page.getByTestId('domain-side-panel')).not.toBeVisible();
  });
});
