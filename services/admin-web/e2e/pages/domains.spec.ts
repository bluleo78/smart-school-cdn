/// 도메인 관리 페이지 E2E 테스트
/// 도메인 목록 조회, 추가 다이얼로그, 삭제 시나리오를 검증한다.
/// 기존 사이드패널(프록시 테스트) 제거됨 — 신규 UI 기준으로 재작성.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';

/** 테스트용 도메인 요약 통계 팩토리 */
function createDomainSummary() {
  return {
    total: 2,
    enabled: 2,
    disabled: 0,
    todayRequests: 0,
    todayRequestsDelta: 0,
    cacheHitRate: 0,
    cacheHitRateDelta: 0,
    todayBandwidth: 0,
    hourlyRequests: Array(24).fill(0),
    hourlyCacheHitRate: Array(24).fill(0),
    hourlyBandwidth: Array(24).fill(0),
    alerts: [],
  };
}

/** 테스트용 도메인 목록 팩토리 */
function createDomains() {
  return [
    {
      host: 'textbook.com',
      origin: 'https://textbook.com',
      enabled: 1,
      description: '',
      created_at: 1700000000,
      updated_at: 1700000000,
    },
    {
      host: 'cdn.school.kr',
      origin: 'https://cdn.school.kr',
      enabled: 1,
      description: '',
      created_at: 1700000100,
      updated_at: 1700000100,
    },
  ];
}

/** 공통 기본 mock 설정 */
async function setupBaseMocks(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
}

test.describe('도메인 관리 — 로딩 및 에러 상태', () => {
  test('도메인 목록 로딩 중에는 로딩 메시지가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    // 500ms 지연으로 로딩 상태 재현
    await mockApi(page, 'GET', '/domains', createDomains(), { delay: 500 });

    await page.goto('/domains');

    // 로딩 스켈레톤이 표시되어야 한다
    await expect(page.locator('[data-testid="domains-table-loading"], .animate-pulse').first()).toBeVisible();
    // 로딩 완료 후 테이블이 나타나야 한다
    await expect(page.getByTestId('domains-table')).toBeVisible();
  });

  test('도메인 목록 조회 실패 시 에러 메시지가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', { error: 'Internal Server Error' }, { status: 500 });

    await page.goto('/domains');

    await expect(page.getByText('도메인 목록을 불러오지 못했습니다.')).toBeVisible();
  });
});

test.describe('도메인 관리 — 도메인 목록', () => {
  test('등록된 도메인이 테이블에 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await expect(page.getByTestId('domains-table')).toBeVisible();
    await expect(page.getByTestId('domain-row-textbook.com')).toBeVisible();
    await expect(page.getByTestId('domain-row-cdn.school.kr')).toBeVisible();
  });

  test('도메인이 없으면 빈 상태 메시지와 CTA 버튼이 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      total: 0,
      enabled: 0,
    });
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    // 빈 상태 컨테이너가 보여야 한다
    await expect(page.getByTestId('domains-empty')).toBeVisible();
    await expect(page.getByText('등록된 도메인이 없습니다')).toBeVisible();
    // CDN 시작 안내 문구가 있어야 한다
    await expect(page.getByText('CDN을 시작하려면 도메인을 추가하세요.')).toBeVisible();
    // CTA 버튼이 표시되어야 한다
    await expect(page.getByTestId('empty-add-domain-btn')).toBeVisible();
  });

  test('빈 상태 CTA 버튼 클릭 시 도메인 추가 다이얼로그가 열린다', async ({ page }) => {
    // 빈 상태에서 CTA를 통해 추가 모달이 열리는 경로를 검증한다
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      total: 0,
      enabled: 0,
    });
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('empty-add-domain-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });
});

test.describe('도메인 관리 — 도메인 추가', () => {
  test('추가 버튼 클릭 시 다이얼로그가 열린다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  test('유효한 도메인 추가 시 다이얼로그가 닫힌다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    await mockApi(page, 'POST', '/domains', {
      host: 'newdomain.com',
      origin: 'https://newdomain.com',
      enabled: 1,
      description: '',
      created_at: 1700000200,
      updated_at: 1700000200,
    });

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('https://newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();
  });

  test('원본 URL이 http/https로 시작하지 않으면 오류가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    // 원본 URL 필드 바로 아래 인라인 에러로 표시 (#16 인라인 에러 개선)
    await expect(page.getByTestId('add-domain-origin-error')).toBeVisible();
  });

  test('host 입력 없이 제출 시 오류가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    // host 비워두고 origin만 입력
    await page.getByTestId('add-domain-origin').fill('https://newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    // 도메인 필드 바로 아래 인라인 에러로 표시 (#16 인라인 에러 개선)
    await expect(page.getByTestId('add-domain-host-error')).toBeVisible();
    // 실패 시 다이얼로그는 닫히지 않아야 한다
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  test('API 오류 시 에러 메시지가 표시되고 다이얼로그가 유지된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    await mockApi(page, 'POST', '/domains', { error: 'Server Error' }, { status: 500 });

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('https://newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    await expect(page.getByTestId('add-domain-error')).toContainText('도메인 추가에 실패했습니다.');
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });
});

test.describe('도메인 관리 — 도메인 삭제', () => {
  test('삭제 버튼 클릭 시 확인 다이얼로그가 열린다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-delete-textbook.com').click();

    await expect(page.getByTestId('delete-domain-dialog')).toBeVisible();
    await expect(page.getByTestId('delete-domain-dialog').getByText('textbook.com')).toBeVisible();
  });

  test('삭제 취소 시 다이얼로그가 닫힌다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-delete-textbook.com').click();
    await expect(page.getByTestId('delete-domain-dialog')).toBeVisible();

    // 취소 버튼 클릭
    await page.getByTestId('delete-domain-dialog').getByText('취소').click();

    await expect(page.getByTestId('delete-domain-dialog')).not.toBeVisible();
  });

  test('삭제 확인 시 다이얼로그가 닫힌다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'DELETE', '/domains/textbook.com', null);

    await page.goto('/domains');

    await page.getByTestId('domain-delete-textbook.com').click();
    await page.getByTestId('delete-domain-confirm').click();

    await expect(page.getByTestId('delete-domain-dialog')).not.toBeVisible();
  });
});

test.describe('도메인 관리 — 다이얼로그 ESC 닫기', () => {
  test('추가 다이얼로그에서 ESC 키를 누르면 닫힌다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();
  });

  test('삭제 확인 다이얼로그에서 ESC 키를 누르면 닫힌다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    await page.getByTestId('domain-delete-textbook.com').click();
    await expect(page.getByTestId('delete-domain-dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-domain-dialog')).not.toBeVisible();
  });
});
