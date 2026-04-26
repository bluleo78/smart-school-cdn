/// DNS 관리 페이지 E2E
/// 탭 진입 / 호스트 필터 / 범위 토글 네트워크 / 오프라인 배너 / 결과 필터 토글을 검증한다.
/// DnsPage 훅(useDnsStatus/useDnsRecords/useDnsMetrics/useDnsQueries)이 동시에 호출되므로
/// goto 전에 4개 엔드포인트를 모두 모킹한 뒤 각 시나리오에서 필요한 부분만 재정의한다.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import {
  createDnsStatusOnline,
  createDnsStatusOffline,
  createDnsRecords,
  createDnsQueriesMixed,
  createDnsMetrics,
} from '../factories/dns.factory';

/** axios params 로 인해 실제 URL 에 ?limit=.../ ?range=... 가 붙는 엔드포인트 전용 모킹.
 *  공통 mockApi 헬퍼는 glob 경로만 사용해 쿼리스트링이 붙으면 매칭되지 않는다.
 *  이 스펙 한정으로 정규식 라우트를 설치해 쿼리스트링 꼬리까지 포착한다. */
async function mockDnsQuery(
  page: import('@playwright/test').Page,
  path: string,
  data: unknown,
) {
  await page.route(new RegExp(`/api${path}(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}

/** DnsPage 4개 훅의 기본 성공 응답 세트 — 각 테스트 시작 시 1회 호출 */
async function mockDnsDefaults(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
  await mockApi(page, 'GET', '/dns/records', createDnsRecords());
  // queries/metrics 는 axios params 로 쿼리스트링 첨부 → 정규식 라우트 사용
  await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
  await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());
}

test.describe('DNS 관리 페이지', () => {
  test('사이드바에서 진입하면 /dns로 이동하고 3개 탭 트리거가 보인다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/');

    // 사이드바 "DNS" 링크 클릭 → /dns로 이동
    await page.getByRole('link', { name: 'DNS' }).click();
    await expect(page).toHaveURL(/\/dns$/);

    // 3개 탭 트리거가 모두 가시 상태
    await expect(page.getByTestId('tab-records')).toBeVisible();
    await expect(page.getByTestId('tab-stats')).toBeVisible();
    await expect(page.getByTestId('tab-queries')).toBeVisible();
  });

  test('레코드 탭 — 존재하지 않는 호스트 검색 시 빈 상태 메시지가 표시된다', async ({ page }) => {
    // 레코드가 있어도 필터에 걸리지 않으면 빈 상태로 전환되는지 검증
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords([
      { host: 'a.test', target: '10.0.0.1', rtype: 'A', source: 'override' },
    ]));
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');
    await page.getByTestId('tab-records').click();

    // 필터 입력 → 매칭되는 레코드가 없도록 임의의 문자열 입력
    await page.getByTestId('records-filter').fill('nomatch-xyz-존재하지-않음');

    await expect(page.getByText('등록된 레코드가 없습니다.')).toBeVisible();
  });

  test('통계 탭 — 24시간 버튼 클릭 시 /api/dns/metrics?range=24h 요청이 발생한다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns');
    await page.getByTestId('tab-stats').click();

    // 24h 범위로 토글되면 TanStack Query가 새 키로 재조회한다
    const req = page.waitForRequest(
      (r) => r.url().includes('/api/dns/metrics') && r.url().includes('range=24h'),
    );
    await page.getByRole('button', { name: '24시간' }).click();
    await req;
  });

  test('dns-service 오프라인 시 장애 배너가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOffline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');

    await expect(page.getByTestId('dns-offline-banner')).toBeVisible({ timeout: 10000 });
  });

  test('통계 탭 — NXDOMAIN 값이 0이면 레이블이 destructive 색상이 아니다 (#12 회귀)', async ({ page }) => {
    // NXDOMAIN = 0인 상태 → StatCard accent가 undefined로 내려가야 한다
    // text-destructive 클래스가 없어야 정상 상태로 보임
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline({ nxdomain: 0 }));
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');
    await page.getByTestId('tab-stats').click();

    // NXDOMAIN 레이블 요소가 text-destructive 클래스를 갖지 않는지 확인
    const nxdomainLabel = page.getByTestId('statcard-label-NXDOMAIN');
    await expect(nxdomainLabel).toBeVisible();
    await expect(nxdomainLabel).not.toHaveClass(/text-destructive/);
  });

  test('통계 탭 — NXDOMAIN 값이 1 이상이면 레이블이 destructive 색상이다', async ({ page }) => {
    // NXDOMAIN > 0이면 오류 상황 → text-destructive 클래스가 있어야 한다
    // totals는 metrics 버킷을 집계하므로 nxdomain 버킷이 있어야 한다
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics([
      { ts: Date.now(), total: 10, matched: 5, nxdomain: 3, forwarded: 2 },
    ]));

    await page.goto('/dns');
    await page.getByTestId('tab-stats').click();

    const nxdomainLabel = page.getByTestId('statcard-label-NXDOMAIN');
    await expect(nxdomainLabel).toBeVisible();
    await expect(nxdomainLabel).toHaveClass(/text-destructive/);
  });

  test('최근 쿼리 탭 — matched 필터를 끄면 a.test 행이 사라진다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns');
    await page.getByTestId('tab-queries').click();

    // 기본 상태: 3건 모두 노출 (matched / forwarded / nxdomain)
    await expect(page.getByText('a.test')).toBeVisible();
    await expect(page.getByText('b.test')).toBeVisible();

    // matched 필터 토글 해제 → a.test(=matched) 행만 사라져야 한다
    await page.getByTestId('filter-matched').click();

    await expect(page.getByText('a.test')).not.toBeVisible();
    await expect(page.getByText('b.test')).toBeVisible();
  });
});

// ─── 빈 데이터 empty state (#21 회귀) ─────────────────────────
test.describe('DNS — 쿼리 추이 차트 empty state (#21)', () => {
  test('메트릭 데이터가 없으면 차트 대신 empty state 메시지가 표시된다', async ({ page }) => {
    // 빈 버킷 배열 → metrics.length === 0 분기 진입 검증
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    // 빈 메트릭 버킷 → 쿼리 추이 차트 empty state 진입
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics([]));

    await page.goto('/dns');
    await page.getByTestId('tab-stats').click();

    // 쿼리 추이 카드 안에 empty state 문구가 노출되어야 한다
    await expect(page.getByText('아직 데이터가 없습니다')).toBeVisible();
    await expect(page.getByText('DNS 쿼리가 들어오면 자동으로 표시됩니다')).toBeVisible();
  });
});
