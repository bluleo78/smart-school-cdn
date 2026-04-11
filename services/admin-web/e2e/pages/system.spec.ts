import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createCertList } from '../factories/tls.factory';

test.describe('시스템 페이지', () => {
  test.beforeEach(async ({ page }) => {
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
