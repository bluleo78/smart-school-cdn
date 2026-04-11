/// 도메인 관리 페이지 E2E 테스트
/// API 모킹으로 프록시 테스트 기능의 성공/실패/에러 시나리오를 검증한다.
import { test, expect } from '@playwright/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';

test.describe('도메인 관리 — 등록 도메인 목록', () => {
  test('기본 등록 도메인이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);

    await page.goto('/domains');

    await expect(page.getByText('httpbin.org')).toBeVisible();
  });
});

test.describe('도메인 관리 — 프록시 테스트', () => {
  test('테스트 성공 시 HTTP 상태코드와 응답 시간이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 200,
      response_time_ms: 42,
    });

    await page.goto('/domains');

    // 기본 입력값으로 테스트 버튼 클릭
    await page.getByTestId('proxy-test-button').click();

    // 성공 결과 표시 확인
    await expect(page.getByTestId('proxy-test-result')).toBeVisible();
    await expect(page.getByText('HTTP 200')).toBeVisible();
    await expect(page.getByText('42ms')).toBeVisible();
  });

  test('프록시 연결 실패 시 오류 메시지가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'POST', '/proxy/test', {
      success: false,
      status_code: 0,
      response_time_ms: 100,
      error: 'connect ECONNREFUSED 127.0.0.1:8080',
    });

    await page.goto('/domains');
    await page.getByTestId('proxy-test-button').click();

    // 실패 결과 표시 확인
    await expect(page.getByTestId('proxy-test-result')).toBeVisible();
    await expect(page.getByText('✗ 실패')).toBeVisible();
    await expect(page.getByText(/ECONNREFUSED/)).toBeVisible();
  });

  test('도메인과 경로를 변경하고 테스트할 수 있다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'POST', '/proxy/test', {
      success: true,
      status_code: 404,
      response_time_ms: 30,
    });

    await page.goto('/domains');

    // 도메인과 경로 변경
    await page.getByTestId('proxy-test-domain').fill('api.test.com');
    await page.getByTestId('proxy-test-path').fill('/not-found');
    await page.getByTestId('proxy-test-button').click();

    // 404 응답 표시 확인 (success: true이지만 400 이상이므로 실패 스타일)
    await expect(page.getByTestId('proxy-test-result')).toBeVisible();
    await expect(page.getByText('HTTP 404')).toBeVisible();
  });

  test('입력 필드가 비어있으면 테스트 버튼이 비활성화된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);

    await page.goto('/domains');

    // 도메인 필드 초기화
    await page.getByTestId('proxy-test-domain').fill('');

    const button = page.getByTestId('proxy-test-button');
    await expect(button).toBeDisabled();
  });
});
