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

  test('레코드 탭 — 검색어 입력 시 검색 결과 없음 메시지가 표시된다 (#41)', async ({ page }) => {
    // 검색어가 있을 때는 "검색 결과 없음" 메시지, 데이터 자체 없음과 구분
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords([
      { host: 'a.test', target: '10.0.0.1', rtype: 'A', source: 'override' },
    ]));
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');
    await page.getByTestId('tab-records').click();

    // 필터 입력 → 매칭되는 레코드가 없도록 임의의 문자열 입력
    const keyword = 'nomatch-xyz-존재하지-않음';
    await page.getByTestId('records-filter').fill(keyword);

    // 검색어 포함한 "일치하는 레코드 없음" 메시지가 표시되어야 한다
    await expect(page.getByText(`"${keyword}"에 일치하는 레코드가 없습니다.`)).toBeVisible();
    // 데이터 없음 메시지는 표시되지 않아야 한다
    await expect(page.getByText('등록된 레코드가 없습니다.')).not.toBeVisible();
  });

  test('레코드 탭 — 레코드가 없을 때 데이터 없음 메시지가 표시된다 (#41)', async ({ page }) => {
    // 데이터 자체가 없을 때는 "등록된 레코드가 없습니다." 메시지가 표시된다
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    // 빈 레코드 배열
    await mockApi(page, 'GET', '/dns/records', createDnsRecords([]));
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');
    await page.getByTestId('tab-records').click();

    // 검색어 없이 데이터가 없으면 "등록된 레코드가 없습니다." 메시지 표시
    await expect(page.getByText('등록된 레코드가 없습니다.')).toBeVisible();
  });

  /**
   * 이슈 #209 회귀 방지 — RecordsTab 검색 입력 IME 조합 중 미완성 자모로 즉시 필터링되어 깜빡임 발생.
   * 수정 전: onChange={e => setQ(e.target.value)} — 미완성 자모 `ㅎ`가 즉시 q에 반영되어 빈 결과 표시.
   * 수정 후: composingRef + onCompositionStart/End 가드 — 조합 중에는 localInput만 갱신, q는 보류 (#189 패턴).
   */
  test('레코드 탭 — IME 조합 중 미완성 자모는 필터에 반영되지 않는다 (회귀: #209)', async ({ page }) => {
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    // host에 'ㅎ'를 포함하지 않는 레코드만 — 가드가 없으면 즉시 빈 상태로 전환됨
    await mockApi(page, 'GET', '/dns/records', createDnsRecords([
      { host: 'a.test', target: '10.0.0.1', rtype: 'A', source: 'override' },
      { host: 'b.test', target: '10.0.0.2', rtype: 'A', source: 'override' },
    ]));
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns?tab=records');

    const input = page.getByTestId('records-filter');
    await expect(input).toBeVisible();

    // IME compositionstart + composing input 시뮬레이션 — Playwright 키 입력으로는
    // isComposing 트리거가 어려우므로 합성 이벤트로 대체 (domain-detail.spec #179 패턴 준용).
    await input.evaluate((el) => {
      const i = el as HTMLInputElement;
      i.focus();
      i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(i, 'ㅎ');
      const ev = new InputEvent('input', { bubbles: true, data: 'ㅎ' });
      Object.defineProperty(ev, 'isComposing', { value: true });
      i.dispatchEvent(ev);
    });

    // 조합 중에는 q에 반영되지 않으므로 레코드 목록은 그대로 유지되고 빈 상태가 노출되지 않아야 한다
    await expect(page.getByText('"ㅎ"에 일치하는 레코드가 없습니다.')).not.toBeVisible();
    await expect(page.getByText('a.test')).toBeVisible();
    await expect(page.getByText('b.test')).toBeVisible();

    // 조합 종료 시 최종 값이 q에 한 번에 반영되어 빈 상태로 전환되어야 한다 (양방향 보장)
    await input.evaluate((el) => {
      const i = el as HTMLInputElement;
      i.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ㅎ' }));
    });
    await expect(page.getByText('"ㅎ"에 일치하는 레코드가 없습니다.')).toBeVisible();
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

  test('통계 탭 — 24시간 범위에서 x축 라벨이 MM/DD HH:mm 형식으로 표시된다 (#198 회귀)', async ({ page }) => {
    // 어제 22:00 / 오늘 02:00 두 버킷 — HH:mm만으로는 같은 일자 식별 불가
    const now = Date.now();
    const yesterday22 = now - 22 * 60 * 60 * 1000; // 24h 윈도우 내, 어제 시점
    const today02 = now - 2 * 60 * 60 * 1000; // 24h 윈도우 내, 오늘 시점
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics([
      { ts: yesterday22, total: 10, matched: 5, nxdomain: 0, forwarded: 5 },
      { ts: today02, total: 20, matched: 10, nxdomain: 0, forwarded: 10 },
    ]));

    await page.goto('/dns?tab=stats');
    await page.getByRole('button', { name: '24시간' }).click();

    // x축 라벨이 'MM/DD HH:mm' 패턴(슬래시·공백 포함)이어야 한다.
    // 1시간 모드의 'HH:mm'만 표기 정책은 24h 경계에서 동일 라벨 충돌 → fail
    await expect.poll(async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('.recharts-xAxis text')).map((t) => t.textContent ?? ''),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/^\d{2}\/\d{2}\s\d{2}:\d{2}$/)]));
  });

  test('통계 탭 — 쿼리 추이 차트 Legend가 한국어 4종(전체/매칭/전달/없음)으로 표시된다 (#222)', async ({ page }) => {
    // KPI 카드 ↔ 라인 색상 매핑 식별 가능해야 한다.
    // nxdomain>0 버킷을 포함시켜 nxdomain 라인까지 4개가 모두 렌더되도록 한다.
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics([
      { ts: Date.now() - 60_000, total: 10, matched: 6, nxdomain: 2, forwarded: 2 },
      { ts: Date.now(), total: 12, matched: 7, nxdomain: 1, forwarded: 4 },
    ]));

    await page.goto('/dns?tab=stats');

    // Legend 컨테이너가 존재해야 한다 (수정 전에는 부재)
    const legend = page.locator('.recharts-legend-wrapper');
    await expect(legend).toBeVisible();

    // 한국어 4종 시리즈 라벨 노출 — Tooltip / Legend 양쪽에서 동일하게 사용됨
    await expect(legend.getByText('전체', { exact: true })).toBeVisible();
    await expect(legend.getByText('매칭', { exact: true })).toBeVisible();
    await expect(legend.getByText('전달', { exact: true })).toBeVisible();
    await expect(legend.getByText('없음', { exact: true })).toBeVisible();

    // nxdomain 라인이 실제로 그려져야 한다 (이전: 3 → 수정 후: 4)
    await expect(page.locator('.recharts-line-curve')).toHaveCount(4);
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

  /**
   * 이슈 #231 — QueriesTab 빈 상태 메시지 분기
   * 진짜 쿼리 0건과 "결과 필터로 0건" 두 상황을 구분해야 한다.
   * - 데이터 0건 → "표시할 쿼리가 없습니다." (data-testid="queries-empty")
   * - 데이터 있음 + 필터 전부 해제 → 필터 안내 + 초기화 CTA (data-testid="queries-empty-filter")
   */
  test('빈 상태 — 데이터 자체가 0건일 때 "표시할 쿼리가 없습니다." 메시지가 표시된다 (#231)', async ({ page }) => {
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', { entries: [] });
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns?tab=queries');

    await expect(page.getByTestId('queries-empty')).toBeVisible();
    // 필터 분기는 노출되지 않아야 한다
    await expect(page.getByTestId('queries-empty-filter')).toHaveCount(0);
  });

  test('빈 상태 — 결과 필터를 모두 해제해 0건 매칭 시 필터 안내 + 초기화 버튼이 표시된다 (#231)', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=queries');

    // 기본 상태에서는 데이터가 노출되어야 한다
    await expect(page.getByText('a.test')).toBeVisible();

    // 결과 필터 3개 모두 해제 → visible.length === 0 이지만 totalCount > 0
    await page.getByTestId('filter-matched').click();
    await page.getByTestId('filter-forwarded').click();
    await page.getByTestId('filter-nxdomain').click();

    const emptyFilter = page.getByTestId('queries-empty-filter');
    await expect(emptyFilter).toBeVisible();
    await expect(emptyFilter).toContainText('필터');
    // 진짜 빈 상태 분기는 노출되지 않아야 한다
    await expect(page.getByTestId('queries-empty')).toHaveCount(0);

    // 초기화 버튼 클릭 → 모든 필터 다시 활성화되어 데이터 노출
    await page.getByTestId('queries-reset-filters-btn').click();
    await expect(page.getByTestId('filter-matched')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('filter-forwarded')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('filter-nxdomain')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('a.test')).toBeVisible();
  });

  // 회귀 테스트: #223 — QueriesTab '시각' 컬럼이 12시간(오전/오후) 포맷으로 표시되어 다른 페이지와 불일치
  test('최근 쿼리 시각 컬럼은 24시간 ko-KR 포맷이며 오전/오후 표기를 포함하지 않는다 (#223)', async ({ page }) => {
    // 고정 시각(13:05:07 = 오후 1:05:07)으로 모킹해 12시간/24시간 분기를 명확히 검증한다.
    const fixed = new Date('2026-01-01T13:05:07+09:00').getTime();
    await mockApi(page, 'GET', '/dns/status', createDnsStatusOnline());
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', {
      entries: [
        {
          ts_unix_ms: fixed,
          client_ip: '10.0.0.1',
          qname: 'a.test',
          qtype: 'A',
          result: 'matched',
          latency_us: 1234,
        },
      ],
    });
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns?tab=queries');

    // 첫 번째 데이터 행의 '시각' 셀(첫 번째 td) — 24시간 포맷 '13시 5분 7초' 류여야 한다
    const firstTimeCell = page.locator('table tbody tr').first().locator('td').first();
    const timeText = (await firstTimeCell.textContent()) ?? '';
    // 12시간제 표식이 없어야 한다 (#223 회귀 방지)
    expect(timeText).not.toMatch(/오전|오후|AM|PM/);
    // 24시간제 13시(=오후 1시)가 포함되어야 한다
    expect(timeText).toMatch(/13/);
  });

  // 회귀 테스트: #47 — 필터 토글 버튼에 aria-pressed ARIA 상태 속성 누락
  test('최근 쿼리 필터 버튼에 aria-pressed 속성이 올바르게 반영된다 (#47)', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns');
    await page.getByTestId('tab-queries').click();

    // 초기 상태: 3개 필터 모두 활성(true)
    await expect(page.getByTestId('filter-matched')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('filter-forwarded')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('filter-nxdomain')).toHaveAttribute('aria-pressed', 'true');

    // matched 토글 해제 → matched만 false, 나머지는 true 유지
    await page.getByTestId('filter-matched').click();
    await expect(page.getByTestId('filter-matched')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('filter-forwarded')).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─── 탭 URL searchParam 동기화 (#114 회귀) ────────────────────
test.describe('DNS — 탭 URL searchParam 동기화 (#114)', () => {
  test('통계 탭 클릭 시 URL에 ?tab=stats 가 반영된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns');

    // 초기 URL에는 ?tab= 파라미터가 없다
    await expect(page).toHaveURL(/\/dns$/);

    // 통계 탭 클릭 → URL에 ?tab=stats 가 추가되어야 한다
    await page.getByTestId('tab-stats').click();
    await expect(page).toHaveURL(/[?&]tab=stats/);
  });

  test('URL에 ?tab=queries 로 직접 접근하면 최근 쿼리 탭이 선택된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=queries');

    // Radix UI Tabs: 선택된 탭은 aria-selected="true", 나머지는 aria-selected="false"
    await expect(page.getByTestId('tab-queries')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-records')).toHaveAttribute('aria-selected', 'false');
  });

  test('통계 탭 진입 후 새로고침하면 통계 탭이 유지된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns');

    await page.getByTestId('tab-stats').click();
    await expect(page).toHaveURL(/[?&]tab=stats/);

    // 새로고침 후에도 통계 탭이 선택 상태를 유지해야 한다
    await mockDnsDefaults(page);
    await page.reload();
    await expect(page.getByTestId('tab-stats')).toHaveAttribute('aria-selected', 'true');
  });

  test('잘못된 ?tab=invalid 파라미터는 레코드 탭으로 폴백된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=invalid');

    // 유효하지 않은 값은 기본 레코드 탭으로 폴백
    await expect(page.getByTestId('tab-records')).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── 통계 탭 range URL searchParam 동기화 (#228 회귀) ────────
// 수정 전: StatsTab 내부 useState 가 탭 unmount 시 초기화되어 24h → 1h 로 리셋되었음.
// 수정 후: range 를 부모(DnsPage)로 lifting 하고 ?range= 로 URL 동기화 → 탭 전환·새로고침에도 유지.
test.describe('DNS — 통계 탭 range URL 동기화 (#228)', () => {
  test('24시간 클릭 시 URL에 ?range=24h 가 반영된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=stats');

    await page.getByRole('button', { name: '24시간' }).click();
    await expect(page).toHaveURL(/[?&]range=24h/);
    await expect(page.getByRole('button', { name: '24시간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('통계 탭에서 24h 선택 후 다른 탭으로 전환했다가 돌아와도 24h가 유지된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=stats');

    // 24시간 선택
    await page.getByRole('button', { name: '24시간' }).click();
    await expect(page.getByRole('button', { name: '24시간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 레코드 탭으로 이동 후 통계 탭으로 복귀
    await page.getByTestId('tab-records').click();
    await expect(page).toHaveURL(/[?&]tab=records/);
    // ?range=24h 는 보존되어야 한다
    await expect(page).toHaveURL(/[?&]range=24h/);

    await page.getByTestId('tab-stats').click();
    // 24시간 버튼 pressed 상태 유지 — 1h로 초기화되면 안 됨
    await expect(page.getByRole('button', { name: '24시간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: '1시간' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('URL ?tab=stats&range=24h 로 직접 진입하면 24시간이 선택된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=stats&range=24h');

    await expect(page.getByRole('button', { name: '24시간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('잘못된 ?range=invalid 값은 1시간으로 폴백된다', async ({ page }) => {
    await mockDnsDefaults(page);
    await page.goto('/dns?tab=stats&range=invalid');

    await expect(page.getByRole('button', { name: '1시간' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

// ─── /api/dns/status 에러 처리 (#173 회귀) ───────────────────
test.describe('DNS — /api/dns/status 에러 처리 (#173)', () => {
  test('status 5xx 시 StatusStrip 에러 카드 + 오프라인 배너(상태 확인 불가)가 표시된다', async ({ page }) => {
    // /api/dns/status 만 5xx로 모킹 → 나머지는 정상 응답으로 채운다
    // 5xx 분기가 빠지면 StatusStrip 이 Skeleton 무한 + 배너 누락이 된다
    await page.route('**/api/dns/status', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'dns-service down' }),
      });
    });
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns');

    // StatusStrip 자리에 ErrorCard (Skeleton 아님) 노출
    await expect(page.getByTestId('dns-status-error')).toBeVisible({ timeout: 10000 });
    // offline 배너 — "상태 확인 불가" 문구 (online=false 시의 "오프라인" 문구와 분리)
    await expect(page.getByTestId('dns-offline-banner')).toBeVisible();
    await expect(page.getByText('DNS 상태를 불러오지 못했습니다.')).toBeVisible();
  });
});

// ─── StatsTab Top 10 — useDnsStatus 에러 분기 (#174 회귀) ─────
test.describe('DNS — StatsTab Top 10 useDnsStatus 에러 처리 (#174)', () => {
  test('status 5xx 시 Top 10 카드는 ErrorCard 를 노출하고 "쿼리가 없습니다" 오표시가 사라진다', async ({ page }) => {
    // /api/dns/status 만 5xx로 모킹 → 나머지는 정상 응답으로 채운다
    // 수정 전: !status 만 검사해 "쿼리가 없습니다." 빈 상태가 그대로 표시됨
    // 수정 후: statusError 분기로 진입해 ErrorCard 노출
    await page.route('**/api/dns/status', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'dns-service down' }),
      });
    });
    await mockApi(page, 'GET', '/dns/records', createDnsRecords());
    await mockDnsQuery(page, '/dns/queries', createDnsQueriesMixed());
    await mockDnsQuery(page, '/dns/metrics', createDnsMetrics());

    await page.goto('/dns?tab=stats');

    // Top 10 ErrorCard 노출
    await expect(page.getByTestId('dns-top10-error')).toBeVisible({ timeout: 10000 });
    // 빈 상태 문구는 더 이상 노출되지 않아야 한다
    await expect(page.getByText('쿼리가 없습니다.')).not.toBeVisible();
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
