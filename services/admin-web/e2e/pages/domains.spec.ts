/// 도메인 관리 페이지 E2E 테스트
/// 도메인 목록 조회, 추가 다이얼로그, 삭제 시나리오를 검증한다.
/// 기존 사이드패널(프록시 테스트) 제거됨 — 신규 UI 기준으로 재작성.
import { test, expect } from '../fixtures/test';
import { mockApi } from '../fixtures/api-mock';
import { createProxyStatusOnline } from '../factories/proxy.factory';
import { createCacheStats } from '../factories/cache.factory';

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

/** 공통 기본 mock 설정
 * TLS 인증서 엔드포인트를 빈 배열로 모킹한다 — DomainsPage가 useCertificates()를
 * 호출하므로 미모킹 시 실제 백엔드로 요청이 새어나갈 수 있다 (#99).
 */
async function setupBaseMocks(page: Parameters<typeof mockApi>[0]) {
  await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
  await mockApi(page, 'GET', '/proxy/requests', []);
  await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
  await mockApi(page, 'GET', '/tls/certificates', []);
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

test.describe('도메인 관리 — 요약 카드', () => {
  /**
   * 이슈 #104 회귀 방지 — DomainSummaryCards API 실패 시 에러 표시 없이 0으로 fallback
   * /domains/summary가 500을 반환하면 카드 대신 에러 메시지가 표시되어야 한다.
   *
   * 모킹 이유: 실제 백엔드가 없거나 오프라인인 상황에서 에러 상태를 확정적으로 재현하기 위함.
   * mock이 재현하는 조건: GET /domains/summary 응답이 500 에러인 상황.
   * 이 mock이 실제 버그 조건과 동일한 이유: useDomainSummary가 반환하는 isError 값은
   * TanStack Query가 응답 상태를 기반으로 설정하므로, 500 응답이 isError=true를 트리거한다.
   */
  test('요약 통계 API 실패 시 에러 메시지가 표시된다 (#104 회귀 방지)', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    // /domains/summary를 500으로 모킹 — isError=true 유발
    await mockApi(page, 'GET', '/domains/summary', { error: 'Internal Server Error' }, { status: 500 });
    await mockApi(page, 'GET', '/domains', []);
    await mockApi(page, 'GET', '/tls/certificates', []);

    await page.goto('/domains');

    // 에러 메시지가 표시되어야 한다 (#104 핵심 — 0으로 fallback 대신)
    await expect(page.getByTestId('domain-summary-error')).toBeVisible();
    await expect(page.getByText('요약 정보를 불러오지 못했습니다.')).toBeVisible();

    // 요약 카드(0 표시)가 보이면 안 된다
    await expect(page.getByTestId('domain-summary-cards')).not.toBeVisible();
  });

  test('오늘 대역폭 카드에 절감량 bytes 값이 표시된다 (#30 회귀 방지)', async ({ page }) => {
    // 1.5 MB 절감 시나리오 — formatBytes 변환 후 숫자 표시 검증
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      todayBandwidth: 1572864, // 1.5 MB
    });
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    const bandwidthCard = page.getByTestId('summary-card-bandwidth');
    await expect(bandwidthCard).toBeVisible();
    // 큰 폰트 숫자값이 카드 안에 표시되어야 한다
    await expect(bandwidthCard.locator('p.text-3xl')).toBeVisible();
    await expect(bandwidthCard.locator('p.text-3xl')).toHaveText('1.5 MB');
  });

  /**
   * 이슈 #87 회귀 방지 — delta=0일 때 DeltaBadge가 "↑ 0.0%" 대신 "— 0.0%" (중립) 표시
   * delta >= 0 조건에서 0이 양수로 처리되어 화살표가 잘못 표시되던 버그.
   */
  test('delta=0일 때 요약 카드에서 ↑ 화살표 없이 중립(—) 표시가 나타난다 (#87 회귀 방지)', async ({
    page,
  }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    // delta가 모두 0인 요약 데이터 — 변화 없음 시나리오
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      todayRequestsDelta: 0,
      cacheHitRateDelta: 0,
    });
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    const summaryCards = page.getByTestId('domain-summary-cards');
    await expect(summaryCards).toBeVisible();

    // delta=0일 때 ↑ 화살표가 표시되면 안 된다 (#87 핵심)
    const arrowTexts = await summaryCards.evaluate((el) =>
      Array.from(el.querySelectorAll('span')).filter((s) => s.textContent?.includes('↑ 0.0')).map((s) => s.textContent),
    );
    expect(arrowTexts).toHaveLength(0);

    // 중립 표시(—)가 표시되어야 한다
    const neutralTexts = await summaryCards.evaluate((el) =>
      Array.from(el.querySelectorAll('span')).filter((s) => s.textContent?.includes('— 0.0')).map((s) => s.textContent),
    );
    expect(neutralTexts.length).toBeGreaterThan(0);
  });

  /**
   * 이슈 #71 회귀 방지 — 768px 뷰포트에서 grid-cols-4 고정으로 스파크라인 overflow
   * 768px 미만 뷰포트에서 요약 카드 컨테이너가 grid-cols-2로 전환되어
   * 카드 너비가 충분히 확보되는지 검증한다.
   */
  test('768px 뷰포트에서 요약 카드 그리드가 2열로 전환된다 (#71 회귀 방지)', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
    await mockApi(page, 'GET', '/domains', createDomains());

    // 768px 뷰포트로 설정하여 모바일/태블릿 환경 재현
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/domains');

    const summaryCards = page.getByTestId('domain-summary-cards');
    await expect(summaryCards).toBeVisible();

    // md(768px) 미만에서 grid-cols-2가 적용되어 카드 너비가 확보되어야 한다 (#71 핵심)
    // Tailwind의 md 브레이크포인트는 768px — setViewportSize(768)는 md 경계에 해당하므로
    // grid-cols-2 md:grid-cols-4에서 md가 활성화된 상태(4열)가 된다.
    // 767px으로 테스트하여 sm(< md) 구간을 명시적으로 검증한다.
    await page.setViewportSize({ width: 767, height: 900 });
    await page.reload();
    await expect(summaryCards).toBeVisible();

    // 각 카드 너비가 overflow를 유발하던 168px 이상이어야 한다 (2열이면 ~340px 이상)
    const cardWidths = await summaryCards.evaluate((el) => {
      const cards = el.querySelectorAll('[data-testid^="summary-card-"]');
      return Array.from(cards).map((c) => c.getBoundingClientRect().width);
    });

    // 2열이면 카드 너비가 300px 이상이어야 한다 (767 / 2 - gap ≈ 375px)
    for (const w of cardWidths) {
      expect(w).toBeGreaterThan(300);
    }
  });

  /**
   * 이슈 #176 회귀 방지 — 모바일 뷰포트(390px)에서 DomainToolbar 액션 버튼이
   * 글자 단위로 세로 줄바꿈되던 문제. 컨테이너를 모바일에서 flex-col로 전환하고
   * 라벨에 whitespace-nowrap을 적용하여 버튼 폭이 자연 너비로 유지되어야 한다.
   */
  test('390px 뷰포트에서 툴바 한글 버튼 라벨이 글자 단위로 줄바꿈되지 않는다 (#176 회귀 방지)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    // iPhone 14 가로 폭 기준으로 모바일 환경 재현
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/domains');

    const addBtn = page.getByTestId('toolbar-add-btn');
    await expect(addBtn).toBeVisible();

    // 버튼 폭이 압축되지 않았는지 확인 — 한 줄 자연 너비여야 한다.
    // 압축 시 ~46px(글자 단위 줄바꿈), 정상 시 80px 이상.
    const dims = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) =>
        /일괄 추가|일괄 삭제/.test(b.textContent ?? ''),
      );
      return btns.map((b) => ({
        text: b.textContent,
        width: (b as HTMLElement).offsetWidth,
        height: (b as HTMLElement).offsetHeight,
      }));
    });

    expect(dims.length).toBeGreaterThanOrEqual(2);
    for (const d of dims) {
      // 글자 단위 줄바꿈 시 너비가 50px 미만으로 떨어짐 → 80px 이상이어야 정상
      expect(d.width).toBeGreaterThan(70);
      // 한 줄 높이(36~40px) 유지 — 줄바꿈 시 높이가 두 배 이상으로 증가
      expect(d.height).toBeLessThan(60);
    }
  });

  /**
   * 이슈 #264 회귀 방지 — 데스크탑(1280·1440) 뷰포트에서 DomainToolbar 검색 input이
   * 부모 flex 컨테이너 안에서 collapse되어 ~46px로 줄어들던 문제. 검색 wrapper에
   * `flex-1 md:flex-none md:w-64` 클래스를 적용해 컨테이너 폭을 명시적으로 보장한다.
   * 1280·1440 두 뷰포트 모두에서 input width가 200px 이상이어야 한다.
   */
  for (const vw of [1280, 1440] as const) {
    test(`${vw}px 뷰포트에서 DomainToolbar 검색 input width가 collapse되지 않는다 (#264 회귀 방지)`, async ({
      page,
    }) => {
      await setupBaseMocks(page);
      await mockApi(page, 'GET', '/domains', createDomains());

      await page.setViewportSize({ width: vw, height: 800 });
      await page.goto('/domains');

      const search = page.getByTestId('domain-search');
      await expect(search).toBeVisible();

      const width = await search.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
      // 데스크탑에서 md:w-64(=256px)이 적용되어야 — collapse 시엔 ~46px
      expect(width).toBeGreaterThanOrEqual(200);
    });
  }

  /**
   * 이슈 #256 회귀 방지 — 4개 통계 카드 동일 수직 stack 룰
   * 제목 → 숫자 → delta → 그래프 순으로 모든 카드가 동일 레이아웃이어야 한다.
   * iPad portrait 810px / landscape 1180px / 데스크탑 1280px / 1440px 4개 viewport에서
   * - 카드 4개가 한 행(top 정렬)에 표시되고
   * - 카드 내부에서 숫자(p.text-3xl)가 sparkline 위에 위치(겹침 없음)해야 한다.
   */
  /**
   * 이슈 #258 회귀 방지 — 4개 KPI 카드 콘텐츠 구조 통일
   * - 첫 카드(전체 도메인)에도 delta 슬롯 + 그래프 슬롯이 다른 카드와 동일 위치에 존재
   * - 4개 카드 그래프 영역(h-9 = 36px)이 모두 같은 높이로 렌더되며 시각 무게가 비슷
   *   (BarSparkline floor 12px + EnabledDisabledGauge 12px stacked bar)
   */
  test('4개 카드 모두 delta 슬롯 + 그래프 슬롯이 동일 위치에 존재한다 (#258 회귀 방지)', async ({
    page,
  }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/domains');

    const summaryCards = page.getByTestId('domain-summary-cards');
    await expect(summaryCards).toBeVisible();

    // 카드 1에 활성/비활성 비율 게이지가 존재 (다른 카드 BarSparkline과 같은 슬롯)
    await expect(page.getByTestId('domain-enabled-gauge')).toBeVisible();

    // 4개 카드 그래프 슬롯이 모두 같은 height(h-9 = 36px)를 가져야 함 — 시각 무게 정렬
    const chartHeights = await summaryCards.evaluate((el) => {
      const cards = el.querySelectorAll('[data-testid^="summary-card-"]');
      return Array.from(cards).map((c) => {
        const charts = c.querySelectorAll('[aria-hidden="true"]');
        const chart = charts[charts.length - 1] as HTMLElement | undefined;
        return chart ? Math.round(chart.getBoundingClientRect().height) : 0;
      });
    });
    expect(chartHeights).toHaveLength(4);
    // 4개 모두 36px(h-9) 같은 높이
    for (const h of chartHeights) {
      expect(h).toBe(36);
    }
  });

  /**
   * 이슈 #258 회귀 방지 — BarSparkline 평탄 데이터 floor
   * 데이터가 모두 0이거나 평탄해도 막대 높이가 12px 이상으로 표시되어
   * 차트 영역(36px)의 1/3 이상을 차지해야 한다.
   */
  test('BarSparkline 평탄/0 데이터에서도 막대 높이가 12px 이상이다 (#258 회귀 방지)', async ({
    page,
  }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    // 모든 hourly 배열이 0인 시나리오 — 카드 3·4의 평탄 라인 재현
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      hourlyRequests: Array(24).fill(0),
      hourlyCacheHitRate: Array(24).fill(0),
      hourlyBandwidth: Array(24).fill(0),
    });
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    const summaryCards = page.getByTestId('domain-summary-cards');
    await expect(summaryCards).toBeVisible();

    // 카드 2·3·4의 BarSparkline 막대 높이가 모두 viewBox 단위 12 이상이어야 한다.
    // #271 3차 수정으로 BarSparkline은 SVG viewBox 0 0 W 36 좌표계의 <rect>로 렌더된다.
    // viewBox가 36 단위 고정이므로 rect.height(svg attr)로 직접 12 이상을 검증한다.
    const barHeights = await summaryCards.evaluate((el) => {
      const cards = el.querySelectorAll(
        '[data-testid="summary-card-requests"], [data-testid="summary-card-cache-hit"], [data-testid="summary-card-bandwidth"]',
      );
      const heights: number[] = [];
      cards.forEach((c) => {
        c.querySelectorAll('svg.h-9 rect').forEach((bar) => {
          const h = parseFloat(bar.getAttribute('height') ?? '0');
          heights.push(h);
        });
      });
      return heights;
    });
    expect(barHeights.length).toBeGreaterThan(0);
    for (const h of barHeights) {
      expect(h).toBeGreaterThanOrEqual(12);
    }
  });

  for (const vw of [810, 1180, 1280, 1440]) {
    test(`${vw}px 뷰포트에서 통계 카드 4개가 동일 수직 stack 레이아웃을 유지한다 (#256 회귀 방지)`, async ({
      page,
    }) => {
      await setupBaseMocks(page);
      await mockApi(page, 'GET', '/domains', createDomains());

      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto('/domains');

      const summaryCards = page.getByTestId('domain-summary-cards');
      await expect(summaryCards).toBeVisible();

      // 4개 카드가 모두 보이고 같은 행에 정렬되어야 한다 (top 좌표 동일)
      const cardTops = await summaryCards.evaluate((el) => {
        const cards = el.querySelectorAll('[data-testid^="summary-card-"]');
        return Array.from(cards).map((c) => Math.round(c.getBoundingClientRect().top));
      });
      expect(cardTops).toHaveLength(4);
      // 모든 카드가 같은 행 — top 차이가 1px 이내
      const minTop = Math.min(...cardTops);
      const maxTop = Math.max(...cardTops);
      expect(maxTop - minTop).toBeLessThanOrEqual(1);

      // 각 카드: 숫자(p.text-3xl) bottom < sparkline(또는 placeholder) top — 겹침 없이 수직 stack
      const layout = await summaryCards.evaluate((el) => {
        const cards = el.querySelectorAll('[data-testid^="summary-card-"]');
        return Array.from(cards).map((c) => {
          const num = c.querySelector('p.text-3xl');
          // 스파크라인(BarSparkline) 또는 placeholder div — 둘 다 h-9
          const charts = c.querySelectorAll('[aria-hidden="true"]');
          const chart = charts[charts.length - 1] as HTMLElement | undefined;
          return {
            numBottom: num ? Math.round((num as HTMLElement).getBoundingClientRect().bottom) : null,
            chartTop: chart ? Math.round(chart.getBoundingClientRect().top) : null,
          };
        });
      });
      for (const { numBottom, chartTop } of layout) {
        expect(numBottom).not.toBeNull();
        expect(chartTop).not.toBeNull();
        // 숫자가 그래프 위에 있어야 한다 (수직 stack)
        expect(numBottom!).toBeLessThan(chartTop!);
      }
    });
  }
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

  /**
   * 이슈 #43 회귀 방지 — 검색 결과 없을 때 잘못된 빈 상태 표시
   * 도메인이 존재하지만 검색어와 일치하지 않을 때, 등록 유도 CTA가 아닌
   * "검색 결과 없음" 메시지가 표시되어야 한다.
   */
  test('검색어와 일치하는 도메인이 없으면 검색 결과 없음 메시지가 표시된다 (#43)', async ({ page }) => {
    await setupBaseMocks(page);
    // 도메인이 존재하지만 검색 API가 빈 배열을 반환하는 시나리오를 모킹한다.
    // 실제로는 서버에서 q 파라미터로 필터링한 결과가 빈 배열이 반환되는 상황이다.
    await mockApi(page, 'GET', '/domains', createDomains());
    // 검색어 적용 시 서버 응답을 빈 배열로 모킹 (q=xxxxxxnotexist 쿼리)
    await mockApi(page, 'GET', '/domains?q=xxxxxxnotexist', []);

    await page.goto('/domains');

    // 검색 필드에 일치하지 않는 검색어 입력
    await page.getByTestId('domain-search').fill('xxxxxxnotexist');

    // 검색 결과 없음 상태가 표시되어야 한다
    await expect(page.getByTestId('domains-empty-search')).toBeVisible();
    // 검색어가 메시지에 포함되어야 한다
    await expect(page.getByText(/xxxxxxnotexist/)).toBeVisible();
    // 등록 유도 CTA 버튼은 표시되지 않아야 한다 (#43 핵심)
    await expect(page.getByTestId('empty-add-domain-btn')).not.toBeVisible();
  });

  /**
   * 이슈 #95 회귀 방지 — 상태 필터(비활성) 적용 시 잘못된 빈 상태 표시
   * 비활성 필터 적용 후 결과가 0건일 때, "등록된 도메인이 없습니다" CTA가 아닌
   * "비활성 상태인 도메인이 없습니다." 메시지가 표시되어야 한다.
   */
  test('비활성 필터 적용 후 결과가 없으면 필터 전용 빈 상태 메시지가 표시된다 (#95)', async ({ page }) => {
    await setupBaseMocks(page);
    // 전체 도메인은 존재하지만 비활성 필터 결과는 빈 배열로 모킹한다.
    // mock이 필요한 이유: 실제 서버에 비활성 도메인이 없을 수 있어 재현 조건을 확정하기 위함.
    // mock이 재현하는 조건: enabled=false 필터 적용 시 서버가 빈 배열 반환하는 상황.
    // 이 mock이 실제 버그 조건과 동일한 이유: DomainsPage는 enabled 파라미터를 서버로 전달하고
    // DomainTable은 응답 배열이 비어있을 때 enabledFilter prop에 따라 분기하기 때문이다.
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains');

    // 비활성 필터 선택
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '비활성', exact: true }).click();

    // 필터 전용 빈 상태가 표시되어야 한다 (#95 핵심)
    await expect(page.getByTestId('domains-empty-filter')).toBeVisible();
    await expect(page.getByText('비활성 상태인 도메인이 없습니다')).toBeVisible();
    await expect(page.getByText('필터를 변경하거나 해제해 보세요.')).toBeVisible();
    // 도메인 추가 CTA 버튼은 표시되지 않아야 한다 (#95 핵심)
    await expect(page.getByTestId('empty-add-domain-btn')).not.toBeVisible();
  });

  /**
   * 이슈 #95 회귀 방지 — 활성 필터도 동일하게 처리되어야 한다
   */
  test('활성 필터 적용 후 결과가 없으면 필터 전용 빈 상태 메시지가 표시된다 (#95)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=true', []);

    await page.goto('/domains');

    // 활성 필터 선택
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '활성', exact: true }).click();

    // 필터 전용 빈 상태가 표시되어야 한다
    await expect(page.getByTestId('domains-empty-filter')).toBeVisible();
    await expect(page.getByText('활성 상태인 도메인이 없습니다')).toBeVisible();
    // 도메인 추가 CTA 버튼은 표시되지 않아야 한다 (#95 핵심)
    await expect(page.getByTestId('empty-add-domain-btn')).not.toBeVisible();
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

  /**
   * 이슈 #242 회귀 방지 — `?enabled` 쿼리 strict 검증
   * 'true'/'false'/없음만 유효하고, 그 외 임의 값은 silent하게 false로 해석되지 않고
   * 무시(undefined)되어야 한다. URL 자체에서도 잘못된 enabled가 정리된다.
   */
  test('?enabled=invalid 같은 잘못된 쿼리값은 무시되고 전체 목록이 표시된다 (#242)', async ({ page }) => {
    await setupBaseMocks(page);
    // mock이 필요한 이유: enabled 파라미터가 undefined로 처리될 때(전체 목록) 응답을 결정하기 위함.
    // mock이 재현하는 조건: 클라이언트가 enabled 파라미터를 빼고 /domains를 호출하는 경우.
    // 이 mock이 실제 버그 조건과 동일한 이유: 버그 fix 후 잘못된 enabled는 undefined로 fallback되어
    // 서버에 enabled 파라미터 없이 전체 목록을 요청하게 된다.
    await mockApi(page, 'GET', '/domains', createDomains());
    // 만약 버그가 살아있어 enabled=false로 호출되면 빈 배열을 돌려 테스트가 실패하도록 모킹
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains?enabled=invalid');

    // 잘못된 값은 무시되어 전체 도메인이 표시되어야 한다
    await expect(page.getByTestId('domains-table')).toBeVisible();
    await expect(page.getByTestId('domain-link-textbook.com')).toBeVisible();
    await expect(page.getByTestId('domain-link-cdn.school.kr')).toBeVisible();

    // URL에서도 잘못된 enabled 파라미터가 제거되어야 한다 (공유 링크 오염 방지)
    await expect.poll(() => new URL(page.url()).searchParams.get('enabled')).toBeNull();
  });

  /**
   * 이슈 #242 — 'True' 같은 대소문자 변형도 strict 비교 대상이므로 무시되어야 한다.
   */
  test('?enabled=True (대문자) 도 무시되고 전체 목록이 표시된다 (#242)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains?enabled=True');

    await expect(page.getByTestId('domain-link-textbook.com')).toBeVisible();
    await expect(page.getByTestId('domain-link-cdn.school.kr')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('enabled')).toBeNull();
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

  test('오리진 URL이 http/https로 시작하지 않으면 오류가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await page.getByTestId('add-domain-host').fill('newdomain.com');
    await page.getByTestId('add-domain-origin').fill('newdomain.com');
    await page.getByTestId('add-domain-submit').click();

    // 오리진 URL 필드 바로 아래 인라인 에러로 표시 (#16 인라인 에러 개선)
    await expect(page.getByTestId('add-domain-origin-error')).toBeVisible();
  });

  /**
   * 이슈 #423 회귀 방지 — 클라 검증을 서버 `isValidOrigin` 과 동기화.
   * 과거에는 path/query/fragment/공백/빈 host/과도 길이가 모두 클라 통과 → 서버 400 → catch 가
   * generic "도메인 추가에 실패했습니다." 로 덮어써 사용자가 사유를 모르는 회귀가 있었다.
   *
   * 각 케이스에서 (a) 인라인 origin 에러 표시 + (b) POST 요청이 발생하지 않음(클라 차단)을 검증.
   */
  for (const { name, origin } of [
    { name: 'path 포함', origin: 'https://example.com/has/path' },
    { name: 'query 포함', origin: 'https://example.com?x=1' },
    { name: 'fragment 포함', origin: 'https://example.com#frag' },
    { name: '빈 host', origin: 'https://' },
    { name: 'host 중간 공백', origin: 'https:// example.com' },
  ]) {
    test(`오리진 URL — ${name} 입력 시 클라 검증이 차단한다 (#423)`, async ({ page }) => {
      await setupBaseMocks(page);
      await mockApi(page, 'GET', '/domains', []);

      // POST 요청이 전송되지 않아야 한다(클라 검증 단계에서 차단)
      let postCalled = false;
      await page.route('**/api/domains', async (route) => {
        if (route.request().method() === 'POST') {
          postCalled = true;
        }
        return route.fallback();
      });

      await page.goto('/domains');
      await page.getByTestId('toolbar-add-btn').click();
      await page.getByTestId('add-domain-host').fill('test-mismatch.example');
      await page.getByTestId('add-domain-origin').fill(origin);
      await page.getByTestId('add-domain-submit').click();

      // 인라인 origin 에러 표시 + 다이얼로그 유지 + 서버 호출 차단
      await expect(page.getByTestId('add-domain-origin-error')).toBeVisible();
      await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
      expect(postCalled).toBe(false);
    });
  }

  /**
   * 이슈 #423 회귀 방지 — 서버가 400 origin_invalid 를 돌려주면 envelope.message 를 사용자에게 그대로 노출.
   * 클라 검증이 통과한 케이스(예: 정책 변경)에서도 사유가 사라지지 않도록 catch 의 generic 메시지를 제거.
   *
   * mock 사용 이유: 클라 검증이 같이 강화되어 path/공백 등은 서버까지 도달하지 않으므로,
   * "서버만 거부하는" 시나리오를 재현하려면 POST 응답을 직접 400 origin_invalid 로 모킹해야 한다.
   */
  test('서버 400 origin_invalid 응답 시 서버 message 를 origin 인라인 에러로 표시 (#423)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    // 서버가 돌려주는 표준 envelope (#410) — 클라 검증을 우회한 입력이 도달했다고 가정
    await mockApi(
      page,
      'POST',
      '/domains',
      { error: 'origin_invalid', message: '유효한 origin URL이 아닙니다. (예: https://example.com, 최대 2083자)' },
      { status: 400 },
    );

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();
    // 클라 검증을 통과하는 정상 origin 으로 입력 (서버만 거부하는 분기 검증)
    await page.getByTestId('add-domain-host').fill('test-passthrough.example');
    await page.getByTestId('add-domain-origin').fill('https://example.com');
    await page.getByTestId('add-domain-submit').click();

    // 서버 message 가 origin 인라인 에러로 노출되어야 한다
    const originError = page.getByTestId('add-domain-origin-error');
    await expect(originError).toBeVisible();
    await expect(originError).toHaveText(/유효한 origin URL이 아닙니다/);
    // 다이얼로그는 유지(닫히지 않음)
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  test('host 입력 없이는 제출 버튼이 비활성화된다 (#232)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    // host 비워두고 origin만 입력 — 빈 입력 가드가 클릭 자체를 차단해야 한다
    await page.getByTestId('add-domain-origin').fill('https://newdomain.com');

    // toolbar/일괄 삭제·DomainCacheSection 퍼지와 일관된 disabled 처리 (#232)
    await expect(page.getByTestId('add-domain-submit')).toBeDisabled();
    // 다이얼로그는 그대로 유지된다
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  /**
   * 이슈 #237 회귀 방지 — Tab 키 이동 순서.
   * host → origin → 추가(submit) → 취소 → 닫기(X) 순으로 흘러야 한다.
   * 시각적 위치(좌:취소, 우:추가)는 flex-row-reverse 로 유지하되 DOM 상으로는
   * 주 액션이 먼저 와서 Tab 사이클이 자연스럽도록 한다.
   */
  test('Tab 순서가 host → origin → 추가 → 취소 → X 닫기 (#237)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // 입력 필드 채워야 submit 이 활성화되어 Tab 포커스 사이클에 포함된다
    await page.getByTestId('add-domain-host').fill('tab.example');
    await page.getByTestId('add-domain-origin').fill('https://tab.example');

    // host → origin
    await page.getByTestId('add-domain-host').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('add-domain-origin')).toBeFocused();

    // origin → 추가(주 액션 먼저)
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('add-domain-submit')).toBeFocused();

    // 추가 → 취소(보조 액션)
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '취소' })).toBeFocused();

    // 취소 → 닫기(X) (Radix DialogContent 기본 마지막 자식)
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '닫기' })).toBeFocused();

    // 시각적 위치는 좌:취소, 우:추가 유지 (flex-row-reverse)
    const submitBox = await page.getByTestId('add-domain-submit').boundingBox();
    const cancelBox = await page.getByRole('button', { name: '취소' }).boundingBox();
    expect(submitBox && cancelBox && submitBox.x > cancelBox.x).toBe(true);
  });

  /**
   * 이슈 #37 회귀 방지 — host 형식 검증 없음 (특수문자·XSS 허용)
   * XSS 페이로드 입력 시 클라이언트 검증이 차단하여 POST 요청이 전송되지 않아야 한다.
   * 모킹 이유: 클라이언트 검증 통과 후 서버로 실제 요청이 가지 않아야 함을 확인하기 위해
   * POST /domains를 모킹하고 호출 여부를 검증한다.
   * mock이 재현하는 조건: handleSubmit이 DOMAIN_RE 체크에서 hasError=true를 설정해 mutateAsync를 호출하지 않는 상황.
   */
  test('XSS 페이로드 host 입력 시 인라인 에러가 표시되고 POST 요청이 전송되지 않는다 (#37)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    // POST가 호출될 경우 201을 반환하도록 모킹 — 실제 호출되면 안 됨
    let postCalled = false;
    await page.route('**/api/domains', (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      } else {
        route.continue();
      }
    });

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();

    // XSS 페이로드 입력
    await page.getByTestId('add-domain-host').fill('<script>alert(1)</script>.evil.com');
    await page.getByTestId('add-domain-origin').fill('https://origin.test');
    await page.getByTestId('add-domain-submit').click();

    // 인라인 에러 표시 및 다이얼로그 유지 확인
    await expect(page.getByTestId('add-domain-host-error')).toBeVisible();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
    // 클라이언트 검증이 차단하여 서버로 요청이 전송되지 않아야 한다
    expect(postCalled).toBe(false);
  });

  test('유효하지 않은 도메인 형식 입력 시 인라인 에러가 표시된다 (#37)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();

    await page.getByTestId('add-domain-host').fill('in valid!domain');
    await page.getByTestId('add-domain-origin').fill('https://origin.test');
    await page.getByTestId('add-domain-submit').click();

    await expect(page.getByTestId('add-domain-host-error')).toBeVisible();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();
  });

  test('와일드카드 도메인(*.textbook.com) 추가가 정상 처리된다 (#37)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);
    await mockApi(page, 'POST', '/domains', {
      host: '*.textbook.com',
      origin: 'https://textbook.com',
      enabled: 1,
      description: '',
      created_at: 1700000300,
      updated_at: 1700000300,
    });

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();

    await page.getByTestId('add-domain-host').fill('*.textbook.com');
    await page.getByTestId('add-domain-origin').fill('https://textbook.com');
    await page.getByTestId('add-domain-submit').click();

    // 와일드카드 도메인은 유효하므로 다이얼로그가 닫혀야 한다
    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();
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

  /**
   * 이슈 #127 회귀 방지 — 도메인 추가 다이얼로그 X 닫기 버튼 부재
   * DialogContent 우상단 X 버튼이 렌더링되어야 하고, 클릭 시 다이얼로그가 닫혀야 한다.
   */
  test('X 닫기 버튼 클릭 시 다이얼로그가 닫힌다 (#127)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();

    // X 닫기 버튼이 우상단에 렌더링되어 있어야 한다
    const dialog = page.getByTestId('add-domain-dialog');
    await expect(dialog).toBeVisible();
    const closeBtn = dialog.getByRole('button', { name: '닫기' });
    await expect(closeBtn).toBeVisible();

    // X 버튼 클릭 시 다이얼로그가 닫혀야 한다
    await closeBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  /**
   * 이슈 #232 회귀 방지 — 단건 추가 다이얼로그 빈 입력 가드
   * host/origin 둘 중 하나라도 비어 있으면 제출 버튼은 disabled여야 한다.
   * (toolbar 일괄 삭제·DomainCacheSection 퍼지와 disabled 처리 일관성)
   */
  test('host/origin 둘 중 하나라도 비어 있으면 제출 버튼이 비활성화된다 (#232)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();

    const submit = page.getByTestId('add-domain-submit');
    const host = page.getByTestId('add-domain-host');
    const origin = page.getByTestId('add-domain-origin');

    // 둘 다 비어 있을 때 — disabled
    await expect(submit).toBeDisabled();

    // host만 입력 — 여전히 disabled
    await host.fill('newdomain.com');
    await expect(submit).toBeDisabled();

    // origin도 입력 — enabled
    await origin.fill('https://newdomain.com');
    await expect(submit).toBeEnabled();

    // origin을 공백만으로 비우면 다시 disabled (.trim() 가드)
    await origin.fill('   ');
    await expect(submit).toBeDisabled();
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

/**
 * 이슈 #55 회귀 방지 — 일괄 추가 형식 오류 메시지 덮어쓰기
 * parseLines()가 형식 오류로 null을 반환할 때, handleSubmit()에서
 * "추가할 도메인을 입력해주세요."로 덮어쓰지 않고 원래 형식 오류 메시지를 유지한다.
 */
test.describe('도메인 관리 — 일괄 추가 (#55)', () => {
  test('잘못된 형식(origin 없이 host만 입력)이면 형식 오류 메시지가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // origin 없이 host만 입력 (잘못된 형식)
    await page.getByTestId('bulk-add-textarea').fill('invalid-domain-only');
    await page.getByTestId('bulk-add-submit').click();

    // "추가할 도메인을 입력해주세요."가 아닌 형식 오류 메시지가 표시되어야 한다 (#55 핵심)
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('잘못된 형식');
    await expect(errorMsg).not.toHaveText('추가할 도메인을 입력해주세요.');
  });

  test('빈 입력이면 일괄 추가 버튼이 비활성화된다 (#232)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 입력 미리보기는 "입력된 도메인이 없습니다" 안내 + 버튼은 disabled (#232)
    await expect(page.getByTestId('bulk-add-preview')).toHaveText('입력된 도메인이 없습니다');
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled();

    // 한 번 입력했다가 비우면 다시 disabled로 돌아가는지 확인 (toggle 회귀)
    await page.getByTestId('bulk-add-textarea').fill('a.example.com https://a.example.com');
    await expect(page.getByTestId('bulk-add-submit')).toBeEnabled();
    await page.getByTestId('bulk-add-textarea').fill('');
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled();
  });

  /**
   * 이슈 #380 회귀 방지 — 입력 변경 후에도 이전 parseError 메시지 잔존
   * 잘못된 형식 제출로 에러 노출 → textarea 내용을 유효 입력으로 교체 →
   * onChange에서 setParseError(null)이 호출되어 stale 에러가 즉시 사라져야 한다.
   * (단건 폼 DomainsPage host/origin onChange의 setHostError/setOriginError clear 패턴과 대칭)
   */
  test('입력 변경 시 이전 parseError 메시지가 즉시 클리어된다 (#380)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 1. 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 2. 잘못된 형식 입력 + 제출 → 에러 노출
    await page.getByTestId('bulk-add-textarea').fill('test1.example.com http://example.com nope');
    await page.getByTestId('bulk-add-submit').click();
    await expect(page.getByTestId('bulk-add-error')).toBeVisible();

    // 3. 유효한 입력으로 교체 → onChange에서 setParseError(null) 호출 → 에러가 즉시 사라져야 함 (#380 핵심)
    await page.getByTestId('bulk-add-textarea').fill('good.example.com https://good.example.com');
    await expect(page.getByTestId('bulk-add-error')).not.toBeVisible();
    await expect(page.getByTestId('bulk-add-preview')).toHaveText('1줄 / 도메인 1개');
  });

  /**
   * 이슈 #42 회귀 방지 — 일괄 추가 시 origin URL 형식 검증 없음 (javascript: scheme 등 허용)
   * javascript:, ftp:// 같은 비정상 scheme이 클라이언트에서 차단되어
   * POST /api/domains/bulk 요청이 전송되지 않아야 한다.
   *
   * 모킹 이유: 클라이언트 검증 통과 후 서버 요청이 가지 않아야 함을 확인하기 위해
   *   POST /domains/bulk를 모킹하고 호출 여부를 검증한다.
   * mock이 재현하는 조건: parseLines()가 origin scheme 검증에서 parseError를 설정해
   *   mutateAsync가 호출되지 않는 상황.
   * 이 mock이 실제 버그 조건과 동일한 이유: useBulkAddDomains 훅이 mutateAsync를 통해
   *   POST 요청을 전송하므로, 호출 여부로 클라이언트 차단 여부를 확인할 수 있다.
   */
  test('javascript: scheme origin 입력 시 인라인 에러가 표시되고 POST 요청이 전송되지 않는다 (#42)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    // POST가 호출될 경우 201을 반환하도록 모킹 — 실제 호출되면 안 됨
    let bulkPostCalled = false;
    await page.route('**/api/domains/bulk', (route) => {
      if (route.request().method() === 'POST') {
        bulkPostCalled = true;
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ inserted: [], failed: [] }) });
      } else {
        route.continue();
      }
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // javascript: scheme origin 입력 (#42 재현 조건)
    await page.getByTestId('bulk-add-textarea').fill('test.example.com javascript:alert(1)');
    await page.getByTestId('bulk-add-submit').click();

    // 인라인 에러가 표시되어야 한다 (#42 핵심)
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('http:// 또는 https://');

    // 다이얼로그가 닫히지 않아야 한다
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 클라이언트 검증이 차단하여 서버로 요청이 전송되지 않아야 한다 (#42 핵심)
    expect(bulkPostCalled).toBe(false);
  });

  test('ftp:// scheme origin 입력 시 인라인 에러가 표시된다 (#42)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // ftp:// scheme origin 입력
    await page.getByTestId('bulk-add-textarea').fill('test.example.com ftp://test.example.com');
    await page.getByTestId('bulk-add-submit').click();

    // 인라인 에러가 표시되어야 한다
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('http:// 또는 https://');
  });

  test('scheme 없는 origin 입력 시 인라인 에러가 표시된다 (#42)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // scheme 없는 origin 입력 — "host origin" 형식은 맞지만 origin이 비정상
    await page.getByTestId('bulk-add-textarea').fill('test.example.com test.example.com');
    await page.getByTestId('bulk-add-submit').click();

    // 인라인 에러가 표시되어야 한다
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('http:// 또는 https://');
  });

  /**
   * 이슈 #178 회귀 방지 — host/origin 외 3번째 토큰 이상 silent drop
   * parts.length > 2인 경우 명시적 에러를 띄워 silent drop을 방지한다.
   * 잘못된 붙여넣기/오타로 의도와 다른 데이터가 등록되는 것을 차단.
   */
  test('한 줄에 토큰이 3개 이상이면 명시적 에러를 표시한다 (#178)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    let bulkAddCalled = false;
    await page.route('**/api/domains/bulk', async (route) => {
      bulkAddCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"added":0}' });
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 3번째 이상 토큰이 포함된 입력 — 이전엔 silent drop으로 첫 두 토큰만 전송됨
    await page
      .getByTestId('bulk-add-textarea')
      .fill('test-extra.invalid https://origin.example.com extra-junk-token');
    await page.getByTestId('bulk-add-submit').click();

    // 인라인 에러가 표시되어야 한다
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('host와 origin 두 값');

    // 서버 호출이 발생하지 않았음을 확인 (silent drop 방지)
    expect(bulkAddCalled).toBe(false);
  });

  /**
   * 이슈 #225 회귀 방지 — 동일 host 두 줄 입력 시 두 번째 origin 무시되고 'skipped' 토스트만 표시
   * 클라이언트 parseLines 단계에서 동일 host 중복을 명시적으로 차단해야 한다.
   * 서버 ON CONFLICT 동작 때문에 첫 줄만 INSERT 되고 두 번째 줄이 "이미 존재"로 잘못 안내되는
   * 데이터 의도 손실을 사전에 방지.
   *
   * mock 정당성: 클라이언트 검증 통과 후 서버 호출이 가지 않아야 함을 검증하기 위해 POST 모킹.
   */
  test('동일 host 가 두 줄 입력되면 인라인 에러 표시 + POST 차단 (#225)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    let bulkAddCalled = false;
    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'POST') {
        bulkAddCalled = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ added: 0, skipped: [], failed: [] }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 동일 host 두 줄(서로 다른 origin) — #225 재현 입력
    await page
      .getByTestId('bulk-add-textarea')
      .fill('bulk-dup-test.invalid https://a.example.com\nbulk-dup-test.invalid https://b.example.com');
    await page.getByTestId('bulk-add-submit').click();

    // 인라인 에러 — 중복 안내 (#225 핵심)
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('중복된 host');
    await expect(errorMsg).toContainText('bulk-dup-test.invalid');

    // 다이얼로그가 닫히지 않아야 한다
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 서버 호출 차단 확인 — 잘못된 'skipped' 토스트가 나갈 여지를 사전 차단
    expect(bulkAddCalled).toBe(false);
  });

  // (#225) 정규화 후(대소문자만 다른) 동일 host 도 중복으로 차단되어야 한다
  test('대소문자만 다른 동일 host 두 줄도 중복 에러로 차단된다 (#225)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    await page
      .getByTestId('bulk-add-textarea')
      .fill('Dup-Case.invalid https://a.example.com\ndup-case.invalid https://b.example.com');
    await page.getByTestId('bulk-add-submit').click();

    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('중복된 host');
  });

  /**
   * 이슈 #170 회귀 방지 — 닫기 후 재오픈 시 입력값/에러 메시지 잔존
   * 외부 Wrapper 컴포넌트가 항상 마운트되어 useState가 보존되는 점이 원인.
   * useEffect로 open=false 전환을 감지해 text/parseError를 리셋한다.
   */
  test('닫기 후 재오픈 시 이전 입력값/에러 메시지가 초기화된다 — 회귀 방지 #170', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 1. 일괄 추가 다이얼로그 열기 → 잘못된 형식 입력 → 에러 노출
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();
    await page.getByTestId('bulk-add-textarea').fill('garbage-no-origin');
    await page.getByTestId('bulk-add-submit').click();
    await expect(page.getByTestId('bulk-add-error')).toBeVisible();

    // 2. ESC로 닫기
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-add-dialog')).not.toBeVisible();

    // 3. 재오픈 — 이전 입력값/에러 메시지가 잔존하지 않아야 함 (#170 핵심)
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();
    await expect(page.getByTestId('bulk-add-textarea')).toHaveValue('');
    await expect(page.getByTestId('bulk-add-error')).not.toBeVisible();
  });

  /**
   * 이슈 #170 회귀 방지 — mutation 진행 중 ESC/취소로 닫기 차단
   * 백엔드 응답을 보류해 isPending 상태를 유지한 뒤 닫기 시도.
   * 이 mock의 정당성: useBulkAddDomains 훅이 mutateAsync를 거치므로 응답을 보류하면
   *   실제 네트워크 지연 상황과 동일하게 isPending=true가 지속된다.
   */
  test('mutation 진행 중에는 ESC/취소로 닫기가 차단된다 — 회귀 방지 #170', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'POST') {
        // 요청을 의도적으로 보류해 isPending 상태를 유지
        await requestPromise;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ added: 1 }) });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/domains');

    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();
    await page.getByTestId('bulk-add-textarea').fill('test.example.com https://test.example.com');
    await page.getByTestId('bulk-add-submit').click();

    // isPending 상태 진입 — 제출 버튼 disabled로 진행 중 상태 확인
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled();

    // ESC로 닫기 시도 — 차단되어야 함 (#170 핵심)
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 취소 버튼도 disabled 상태로 닫기 차단 (#170 핵심)
    await expect(page.getByRole('button', { name: '취소' })).toBeDisabled();

    // 취소 버튼 클릭 시도 — 차단되어야 함 (#170 핵심)
    await page.getByRole('button', { name: '취소' }).click({ force: true }).catch(() => {});
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // cleanup: 보류 해제로 행잉 방지
    resolveRequest!(null);
  });

  /**
   * 이슈 #421 회귀 방지 — AddDomainDialog mutation 진행 중 silent close 차단
   *
   * 과거: `<Dialog open onClose>` 래퍼가 DomainsPage 본체에 있어 mutation 상태에 접근하지 못해
   *      ESC/백드롭/X/취소 4개 닫기 경로가 모두 무방비였고, 다이얼로그가 unmount 되어
   *      `setSubmitError`/`toast.success` 가 사용자에게 노출되지 않는 silent close 가 발생.
   * 수정 후: Dialog 를 컴포넌트 내부로 끌어와 isPending 가드를 4개 경로 모두에 일관 적용.
   *
   * mock 사용 이유: useAddDomain mutateAsync 응답을 보류해 isPending=true 를 유지해야
   *              가드 동작을 검증할 수 있다. mock 은 실제 네트워크 지연 시나리오와 동일하게
   *              훅이 isPending 상태로 잠겨 있는 상태를 재현한다.
   */
  test('AddDomainDialog: mutation 진행 중에는 ESC/취소/X 로 닫기가 차단된다 — 회귀 방지 #421', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    let resolveRequest: (value: unknown) => void;
    const requestPromise = new Promise((resolve) => { resolveRequest = resolve; });

    // POST /api/domains 응답을 보류해 isPending 상태 유지 — 실제 네트워크 지연 재현
    await page.route('**/api/domains', async (route) => {
      if (route.request().method() === 'POST') {
        await requestPromise;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ host: 'silent.example.com', origin: 'https://silent.example.com', enabled: 1, description: '', created_at: 1700000000, updated_at: 1700000000 }),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/domains');
    await page.getByTestId('toolbar-add-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    await page.getByTestId('add-domain-host').fill('silent.example.com');
    await page.getByTestId('add-domain-origin').fill('https://silent.example.com');
    await page.getByTestId('add-domain-submit').click();

    // isPending 진입 — 제출 버튼이 disabled + "추가 중…" 텍스트로 진행 중 확인
    await expect(page.getByTestId('add-domain-submit')).toBeDisabled();
    await expect(page.getByTestId('add-domain-submit')).toHaveText('추가 중…');

    // ESC 닫기 시도 — 차단되어야 함 (#421 핵심)
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // 취소 버튼 disabled 확인 (#421 핵심)
    await expect(page.getByRole('button', { name: '취소' })).toBeDisabled();
    // force 클릭이어도 disabled 핸들러는 발화하지 않아 다이얼로그 유지
    await page.getByRole('button', { name: '취소' }).click({ force: true }).catch(() => {});
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // X(닫기) 버튼 disabled 확인 — DialogContent disableClose 가드
    await expect(page.getByRole('button', { name: '닫기' })).toBeDisabled();
    await page.getByRole('button', { name: '닫기' }).click({ force: true }).catch(() => {});
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // 보류 해제 → mutation 완료 → 정상적으로 다이얼로그가 닫힌다
    resolveRequest!(null);
    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();
  });

  /**
   * 이슈 #197 회귀 방지 — 기존 host 가 포함된 일괄 추가 시 skipped 안내
   *
   * 과거: 서버가 기존 host 의 origin 을 silently upsert 했고, 토스트는 "N건이 추가되었습니다"
   *      로만 표시되어 사용자가 origin 변경 사실을 인지하지 못했다.
   * 수정 후: 서버가 added/skipped/failed 로 분리 응답하며, 클라이언트는 skipped 가 있으면
   *         warning 토스트로 "이미 존재함 (덮어쓰기 안 됨)" 안내를 노출한다.
   *
   * mock 사용 이유: 서버 응답을 added=1, skipped=[exists.com] 로 강제하여 클라이언트가 분기 안내를 띄우는지 검증.
   * mock 정당성: useBulkAddDomains 훅이 BulkAddResult 를 그대로 받아 토스트 분기를 결정하므로,
   *             응답 형태만 모킹하면 실제 서버와 동등한 클라이언트 분기 동작을 재현할 수 있다.
   */
  test('기존 host 가 포함된 응답이면 "이미 존재함" 경고 토스트가 노출된다 (#197)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            added: 1,
            skipped: [{ host: 'exists.com', existingOrigin: 'https://exists.original' }],
            failed: [],
          }),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 기존 host + 신규 host 혼합 입력
    await page.getByTestId('bulk-add-textarea').fill(
      'exists.com https://exists.changed\nnewfresh.com https://newfresh.com',
    );
    await page.getByTestId('bulk-add-submit').click();

    // 토스트 본문 — "1건 추가" 와 "이미 존재함 (덮어쓰기 안 됨)" 모두 노출되어야 함 (#197 핵심)
    // sonner 의 토스트는 [data-sonner-toast] 컨테이너에 렌더링된다.
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('1건 추가');
    await expect(toast).toContainText('이미 존재함');
    await expect(toast).toContainText('덮어쓰기 안 됨');
    // skipped host 와 보존된 origin 이 description 에 포함 — 사용자가 어느 host 가 무시됐는지 확인 가능
    await expect(toast).toContainText('exists.com');
    await expect(toast).toContainText('https://exists.original');
  });
});

/**
 * 이슈 #68 회귀 방지 — 검색 필터 URL 동기화
 * DomainsPage가 useSearchParams로 필터를 관리하여 검색어와 상태 필터가
 * URL querystring(?q=..., ?enabled=...)에 반영되고, 새로고침 시 복원되어야 한다.
 */
test.describe('도메인 관리 — 검색 필터 URL 동기화 (#68)', () => {
  test('검색어 입력 시 URL ?q= 파라미터에 반영된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=textbook', createDomains());

    await page.goto('/domains');

    // 검색어 입력 (debounce 300ms 대기)
    await page.getByTestId('domain-search').fill('textbook');
    await page.waitForTimeout(400);

    // URL에 ?q=textbook이 반영되어야 한다 (#68 핵심)
    expect(page.url()).toContain('q=textbook');
  });

  test('URL ?q= 파라미터가 있으면 페이지 로드 시 검색어가 복원된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=textbook', createDomains());

    // 검색어가 포함된 URL로 직접 접근
    await page.goto('/domains?q=textbook');

    // 검색 입력 필드에 검색어가 복원되어야 한다 (#68 핵심)
    await expect(page.getByTestId('domain-search')).toHaveValue('textbook');
  });

  test('활성 필터 변경 시 URL ?enabled= 파라미터에 반영된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=true', createDomains());

    await page.goto('/domains');

    // 활성 필터 선택 — listbox 내에서 option을 찾아 strict mode 위반 방지
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '활성', exact: true }).click();
    await page.waitForTimeout(100);

    // URL에 ?enabled=true가 반영되어야 한다 (#68 핵심)
    expect(page.url()).toContain('enabled=true');
  });

  test('URL ?enabled=true 파라미터가 있으면 페이지 로드 시 필터가 복원된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=true', createDomains());

    // 필터가 포함된 URL로 직접 접근
    await page.goto('/domains?enabled=true');

    // API 요청에 enabled=true가 포함되어야 한다 (필터 복원 확인)
    const domainsReq = page.waitForRequest(/\/api\/domains\?enabled=true/);
    // 이미 로드된 경우를 위해 refetch 트리거
    await page.reload();
    await domainsReq;
  });
});

/**
 * 이슈 #213 회귀 방지 — 검색 입력 클리어(X) 버튼
 * DomainToolbar 검색 입력에 값이 있으면 X 버튼이 노출되고,
 * 클릭 시 입력값과 URL ?q= 파라미터가 즉시 비워져야 한다.
 */
test.describe('도메인 관리 — 검색 클리어 버튼 (#213)', () => {
  test('검색어 입력 전에는 X 버튼이 보이지 않는다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 입력값이 없으면 클리어 버튼은 렌더링되지 않아야 한다
    await expect(page.getByTestId('domain-search-clear')).toHaveCount(0);
  });

  test('검색어 입력 시 X 버튼이 노출되고, 클릭 시 입력과 URL이 모두 비워진다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=textbook', createDomains());

    await page.goto('/domains');

    // 검색어 입력 (debounce 300ms 대기)
    await page.getByTestId('domain-search').fill('textbook');
    await page.waitForTimeout(400);

    // X 버튼이 노출되고, URL은 ?q=textbook 상태
    await expect(page.getByTestId('domain-search-clear')).toBeVisible();
    expect(page.url()).toContain('q=textbook');

    // X 클릭 → 입력값/URL 즉시 비워짐 (debounce 대기 없이)
    await page.getByTestId('domain-search-clear').click();
    await expect(page.getByTestId('domain-search')).toHaveValue('');
    expect(page.url()).not.toContain('q=');
    // 비워졌으므로 X 버튼 자체도 사라져야 한다
    await expect(page.getByTestId('domain-search-clear')).toHaveCount(0);
  });

  test('X 버튼은 aria-label로 식별 가능하다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByTestId('domain-search').fill('a');
    await expect(page.getByRole('button', { name: '검색 지우기' })).toBeVisible();
  });
});

/**
 * 이슈 #243 회귀 방지 — 검색 입력 trim 누락
 * 공백만 입력하거나 양 끝 공백이 포함된 검색어가 그대로 URL `?q=` 와 API에 실리면
 * 정상 도메인이 0건으로 보이는 거짓 빈 상태가 발생한다. 입력값을 trim하여
 * 빈 문자열은 undefined로 흘리고, 양 끝 공백은 잘라낸 값만 전달해야 한다.
 */
test.describe('도메인 관리 — 검색 입력 trim 정규화 (#243)', () => {
  test('공백만 입력하면 URL ?q= 가 추가되지 않고 결과가 유지된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 공백 3개 입력 — debounce 300ms 후 처리
    await page.getByTestId('domain-search').fill('   ');
    await page.waitForTimeout(400);

    // URL에 ?q= 가 들어가면 안 된다 (#243 핵심)
    expect(page.url()).not.toContain('q=');
    // 도메인 목록은 그대로 표시되어야 한다 (거짓 빈 상태 발생 X)
    await expect(page.getByTestId('domains-table')).toBeVisible();
  });

  test('양 끝 공백이 포함된 검색어는 trim된 값으로 URL에 반영된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=textbook', createDomains());

    await page.goto('/domains');

    // 양 끝 공백 포함 입력
    await page.getByTestId('domain-search').fill('  textbook  ');
    await page.waitForTimeout(400);

    // URL에는 trim된 값만 반영되어야 한다 — `q=textbook+++` 같은 형태가 되면 안 됨
    expect(page.url()).toContain('q=textbook');
    expect(page.url()).not.toMatch(/q=[^&]*\+/);
  });
});

/**
 * 이슈 #70 회귀 방지 — 토글/퍼지 버튼 뮤테이션 진행 중 disabled 미처리
 * toggleMutation 또는 purgeMutation이 isPending 상태일 때,
 * 토글/퍼지 버튼이 disabled 처리되어 중복 클릭이 불가능해야 한다.
 */
/**
 * 이슈 #322 회귀 방지 — DomainToolbar 검색 input ESC 키로 비우기
 * 키보드 사용자가 검색 결과 필터링 후 표준 단축키(ESC)로 즉시 전체 보기로 복귀할 수 있어야 한다.
 * X 버튼 클릭과 동일하게 입력값과 URL `?q=`가 모두 비워져야 한다.
 */
test.describe('도메인 관리 — 검색 input ESC 키 클리어 (#322)', () => {
  test('검색어 입력 후 ESC 키 누르면 입력값과 URL ?q= 가 모두 비워진다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=httpbin', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 검색어 입력 (debounce 300ms 대기 후 URL ?q= 반영 확인)
    const search = page.getByTestId('domain-search');
    await search.fill('httpbin');
    await page.waitForTimeout(400);
    expect(page.url()).toContain('q=httpbin');

    // 입력 필드에 포커스가 있는 상태에서 ESC — debounce 대기 없이 즉시 비워짐
    await search.focus();
    await search.press('Escape');

    await expect(search).toHaveValue('');
    expect(page.url()).not.toContain('q=');
    // 비워졌으므로 X 버튼도 사라져야 한다
    await expect(page.getByTestId('domain-search-clear')).toHaveCount(0);
  });

  test('빈 입력에서 ESC 누르면 다른 동작(예: 모달 닫기)을 가로채지 않는다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const search = page.getByTestId('domain-search');
    await search.focus();
    // 빈 입력 상태에서 ESC — 아무 일도 발생하지 않아야 한다 (preventDefault 미발동)
    await search.press('Escape');

    await expect(search).toHaveValue('');
    expect(page.url()).not.toContain('q=');
  });
});

test.describe('도메인 관리 — 토글/퍼지 중복 클릭 방지 (#70)', () => {
  test('토글 API 요청 중에는 토글 버튼이 disabled 상태가 된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    // 토글 API를 300ms 지연시켜 isPending 상태를 관찰한다
    await mockApi(page, 'POST', '/domains/textbook.com/toggle', { host: 'textbook.com', origin: 'https://textbook.com', enabled: 0, description: '', created_at: 1700000000, updated_at: 1700000000 }, { delay: 300 });

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const toggleBtn = page.getByTestId('domain-toggle-textbook.com');

    // 클릭 전: 버튼이 활성화되어 있어야 한다
    await expect(toggleBtn).not.toBeDisabled();

    // 토글 클릭 — 응답 대기 없이 즉시 disabled 상태 확인
    await toggleBtn.click();

    // 뮤테이션 진행 중: 버튼이 disabled 상태여야 한다 (#70 핵심)
    await expect(toggleBtn).toBeDisabled();

    // 응답 완료 후: 버튼이 다시 활성화되어야 한다
    await expect(toggleBtn).not.toBeDisabled({ timeout: 2000 });
  });

  /**
   * 회귀 방지 — 다른 행 토글 race (#205)
   * 서로 다른 두 행의 토글을 빠르게 연속 클릭했을 때, 첫 번째 행도 응답이 올 때까지
   * disabled가 유지되어야 한다. 단일 useMutation의 variables가 최신 호출로 덮여써져
   * 첫 행의 disabled가 풀리던 race를 useMutationState 기반 in-flight 집합 추적으로 차단한다.
   */
  test('서로 다른 두 행의 토글 연속 클릭 시 두 행 모두 응답 완료까지 disabled 유지된다 (#205)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    // 두 도메인의 토글 응답을 모두 600ms 지연 — 두 mutation이 동시에 in-flight 상태가 되도록
    await mockApi(page, 'POST', '/domains/textbook.com/toggle', { host: 'textbook.com', origin: 'https://textbook.com', enabled: 0, description: '', created_at: 1700000000, updated_at: 1700000000 }, { delay: 600 });
    await mockApi(page, 'POST', '/domains/cdn.school.kr/toggle', { host: 'cdn.school.kr', origin: 'https://cdn.school.kr', enabled: 0, description: '', created_at: 1700000100, updated_at: 1700000100 }, { delay: 600 });

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const toggleA = page.getByTestId('domain-toggle-textbook.com');
    const toggleB = page.getByTestId('domain-toggle-cdn.school.kr');

    // 두 버튼 모두 처음엔 활성화
    await expect(toggleA).not.toBeDisabled();
    await expect(toggleB).not.toBeDisabled();

    // A 클릭 → 즉시 B 클릭 (1초 안에)
    await toggleA.click();
    await toggleB.click();

    // 핵심 검증: B가 클릭되어도 A는 여전히 disabled여야 한다 (#205 race 방지)
    await expect(toggleA).toBeDisabled();
    await expect(toggleB).toBeDisabled();

    // 응답 완료 후 두 버튼 모두 다시 활성화
    await expect(toggleA).not.toBeDisabled({ timeout: 3000 });
    await expect(toggleB).not.toBeDisabled({ timeout: 3000 });
  });

  test('퍼지 API 요청 중에는 퍼지 버튼이 disabled 상태가 된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    // 퍼지 API를 300ms 지연시켜 isPending 상태를 관찰한다
    await mockApi(page, 'POST', '/domains/textbook.com/purge', null, { delay: 300 });

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const purgeBtn = page.getByTestId('domain-purge-textbook.com');

    // 클릭 전: 버튼이 활성화되어 있어야 한다
    await expect(purgeBtn).not.toBeDisabled();

    // 퍼지 클릭 — 응답 대기 없이 즉시 disabled 상태 확인
    await purgeBtn.click();

    // 뮤테이션 진행 중: 버튼이 disabled 상태여야 한다 (#70 핵심)
    await expect(purgeBtn).toBeDisabled();

    // 응답 완료 후: 버튼이 다시 활성화되어야 한다
    await expect(purgeBtn).not.toBeDisabled({ timeout: 2000 });
  });
});

/**
 * 이슈 #83 회귀 방지 — 도메인 목록 테이블 컬럼 정렬 UI 미구현
 * "도메인" 컬럼 헤더 클릭 시 sort/order URL 파라미터가 반영되고,
 * 두 번째 클릭에서 방향이 토글되어야 한다. aria-sort 속성도 검증한다.
 */
test.describe('도메인 관리 — 컬럼 정렬 (#83)', () => {
  test('도메인 컬럼 헤더 클릭 시 URL에 sort=host&order=asc가 반영된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?sort=host&order=asc', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 정렬 전 URL에 sort/order 파라미터가 없어야 한다
    expect(page.url()).not.toContain('sort=');

    // 도메인 컬럼 헤더 클릭
    await page.getByTestId('domain-col-host').click();

    // URL에 sort=host&order=asc가 반영되어야 한다 (#83 핵심)
    expect(page.url()).toContain('sort=host');
    expect(page.url()).toContain('order=asc');
  });

  test('같은 컬럼 헤더를 두 번 클릭하면 order가 asc→desc로 토글된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?sort=host&order=asc', createDomains());
    await mockApi(page, 'GET', '/domains?sort=host&order=desc', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const hostHeader = page.getByTestId('domain-col-host');

    // 첫 번째 클릭 → asc
    await hostHeader.click();
    expect(page.url()).toContain('order=asc');

    // 두 번째 클릭 → desc
    await hostHeader.click();
    expect(page.url()).toContain('order=desc');
  });

  test('sort=host&order=asc URL로 직접 접근 시 도메인 헤더에 ↑ 표시와 aria-sort="ascending"이 적용된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?sort=host&order=asc', createDomains());

    // sort 파라미터가 포함된 URL로 직접 접근
    await page.goto('/domains?sort=host&order=asc');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const hostHeader = page.getByTestId('domain-col-host');

    // ↑ 화살표가 헤더에 표시되어야 한다 (#83 핵심)
    await expect(hostHeader).toContainText('↑');

    // aria-sort 속성이 "ascending"으로 설정되어야 한다 (접근성)
    await expect(hostHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  test('sort=host&order=desc URL로 직접 접근 시 도메인 헤더에 ↓ 표시와 aria-sort="descending"이 적용된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?sort=host&order=desc', createDomains());

    await page.goto('/domains?sort=host&order=desc');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    const hostHeader = page.getByTestId('domain-col-host');

    // ↓ 화살표가 헤더에 표시되어야 한다
    await expect(hostHeader).toContainText('↓');

    // aria-sort 속성이 "descending"으로 설정되어야 한다 (접근성)
    await expect(hostHeader).toHaveAttribute('aria-sort', 'descending');
  });

  test('정렬 미적용 시 도메인 헤더에 aria-sort="none"이 적용된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 정렬하지 않은 상태에서 aria-sort="none"이어야 한다
    await expect(page.getByTestId('domain-col-host')).toHaveAttribute('aria-sort', 'none');
  });
});

/**
 * 이슈 #99 회귀 방지 — DomainTable TLS 컬럼 하드코딩 em-dash
 * DomainsPage가 GET /api/tls/certificates 를 한 번 조회해 도메인별 만료일을 맵으로 만들고,
 * DomainTable이 TlsStatusBadge로 표시한다.
 *
 * 모킹 이유: 실제 백엔드의 인증서 만료일은 테스트마다 다를 수 있으므로 고정값으로 재현 조건을 확정.
 * mock이 재현하는 조건: certificates API가 textbook.com은 60일 후 만료, cdn.school.kr은 3일 후 만료를 반환.
 * 이 mock이 실제 버그 조건과 동일한 이유: DomainTable은 tlsExpiryByHost 맵에서 도메인별 만료일을 조회해
 * TlsStatusBadge에 전달하므로, mock 응답이 실제 렌더링 경로를 그대로 따른다.
 */
test.describe('도메인 관리 — TLS 상태 표시 (#99)', () => {
  test('TLS 인증서 목록을 조회해 각 도메인 행에 TLS 상태 배지가 표시된다 (#99 회귀 방지)', async ({ page }) => {
    const now = new Date();
    // textbook.com: 60일 후 만료 → '유효' 배지
    const future60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
    // cdn.school.kr: 3일 후 만료 → '3일 후 만료' 배지
    const future3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/tls/certificates', [
      { domain: 'textbook.com', issued_at: now.toISOString(), expires_at: future60 },
      { domain: 'cdn.school.kr', issued_at: now.toISOString(), expires_at: future3 },
    ]);

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // textbook.com 행에 '유효' 배지가 표시되어야 한다 (#99 핵심 — em-dash 대신 실제 TLS 상태)
    const textbookRow = page.getByTestId('domain-row-textbook.com');
    await expect(textbookRow.getByText('유효')).toBeVisible();

    // cdn.school.kr 행에 'N일 후 만료' 배지가 표시되어야 한다
    const cdnRow = page.getByTestId('domain-row-cdn.school.kr');
    await expect(cdnRow.getByText(/\d+일 후 만료/)).toBeVisible();
  });

  test('TLS 인증서 미발급 도메인은 "미발급" 배지가 표시된다 (#99 회귀 방지)', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', createDomainSummary());
    await mockApi(page, 'GET', '/domains', createDomains());
    // textbook.com만 인증서 있고, cdn.school.kr은 미발급인 시나리오
    await mockApi(page, 'GET', '/tls/certificates', [
      { domain: 'textbook.com', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60 * 86400_000).toISOString() },
    ]);

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 인증서가 없는 cdn.school.kr 행에는 '미발급' 배지가 표시되어야 한다
    const cdnRow = page.getByTestId('domain-row-cdn.school.kr');
    await expect(cdnRow.getByText('미발급')).toBeVisible();
  });
});

/**
 * 이슈 #29 — 포커스 복귀 및 포커스 트랩 회귀 테스트
 * Radix UI Dialog 교체 후 WCAG 2.4.3 준수 검증:
 * 1. 닫힘 후 트리거 버튼으로 포커스 복귀
 * 2. 열린 상태에서 Tab이 다이얼로그 안에서만 순환 (포커스 트랩)
 */
test.describe('도메인 관리 — 다이얼로그 포커스 관리 (#29)', () => {
  test('ESC로 닫으면 트리거 버튼("+ 도메인 추가")으로 포커스가 복귀한다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    // Radix는 다이얼로그 열릴 때의 activeElement를 기억하여 닫힐 때 복귀시킨다.
    // page.focus()로 키보드 포커스를 버튼에 올린 뒤 Enter로 열어야 올바른 복귀 대상이 기록된다.
    await page.getByTestId('toolbar-add-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // ESC로 닫기
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-domain-dialog')).not.toBeVisible();

    // WCAG 2.4.3: 닫힌 후 포커스가 트리거 버튼으로 복귀해야 한다
    await expect(page.getByTestId('toolbar-add-btn')).toBeFocused();
  });

  test('다이얼로그 열린 상태에서 Tab을 여러 번 눌러도 포커스가 다이얼로그 안에 머문다 (포커스 트랩)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', []);

    await page.goto('/domains');

    await page.getByTestId('toolbar-add-btn').click();
    await expect(page.getByTestId('add-domain-dialog')).toBeVisible();

    // 다이얼로그 안의 포커스 가능 요소 수보다 많이 Tab을 눌러 순환을 확인
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }

    // 포커스가 다이얼로그 콘텐츠 안에 있어야 한다 (다이얼로그 바깥으로 이탈 금지)
    const focusInDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="add-domain-dialog"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(focusInDialog).toBe(true);
  });
});

/**
 * 이슈 #101 회귀 방지 — DomainAlertBanner 다중 TLS 만료 임박 시 첫 번째 도메인만 링크
 * 알림이 복수일 때 각 도메인에 개별 링크가 제공되어야 한다.
 *
 * 모킹 이유: 실제 백엔드의 TLS 알림 건수는 환경마다 다르므로 재현 조건을 확정하기 위함.
 * mock이 재현하는 조건: /domains/summary가 특정 호스트를 포함한 tls_expiring 알림을 반환하는 상황.
 * 이 mock이 실제 버그 조건과 동일한 이유: DomainAlertBanner는 useDomainSummary().data.alerts를
 * 직접 읽어 링크를 렌더링하므로, mock 응답이 실제 렌더링 경로를 그대로 따른다.
 */
test.describe('도메인 관리 — DomainAlertBanner 다중 알림 링크 (#101)', () => {
  test('TLS 만료 임박 알림이 1건이면 해당 도메인으로 직접 링크한다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      alerts: [{ type: 'tls_expiring', host: 'textbook.com' }],
    });
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/tls/certificates', []);

    await page.goto('/domains');

    const banner = page.getByTestId('domain-alert-banner');
    await expect(banner).toBeVisible();

    // 1건이면 해당 도메인 링크 하나만 있어야 한다 (#101 핵심)
    const link = banner.getByTestId('domain-alert-link-textbook.com');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/domains/textbook.com');
  });

  test('TLS 만료 임박 알림이 3건이면 각 도메인에 개별 링크가 표시된다 (#101 핵심)', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      alerts: [
        { type: 'tls_expiring', host: 'first-domain.example' },
        { type: 'tls_expiring', host: 'test-explorer.invalid' },
        { type: 'tls_expiring', host: 'httpbin.org' },
      ],
    });
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/tls/certificates', []);

    await page.goto('/domains');

    const banner = page.getByTestId('domain-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('TLS 만료 임박 3건');

    // 3건 각각에 개별 링크가 있어야 한다 (#101 핵심 — 첫 번째 도메인 링크만 있으면 실패)
    await expect(banner.getByTestId('domain-alert-link-first-domain.example')).toBeVisible();
    await expect(banner.getByTestId('domain-alert-link-test-explorer.invalid')).toBeVisible();
    await expect(banner.getByTestId('domain-alert-link-httpbin.org')).toBeVisible();

    // 각 링크가 해당 도메인 상세 페이지로 이동해야 한다
    await expect(banner.getByTestId('domain-alert-link-test-explorer.invalid')).toHaveAttribute(
      'href',
      '/domains/test-explorer.invalid',
    );
  });

  test('sync_failed 알림 1건도 해당 도메인으로 직접 링크한다', async ({ page }) => {
    // sync_failed 타입도 동일 컴포넌트 경로를 거치므로 회귀 보호 필요 (#101)
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      alerts: [{ type: 'sync_failed', host: 'cdn.school.kr' }],
    });
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/tls/certificates', []);

    await page.goto('/domains');

    const banner = page.getByTestId('domain-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('동기화 실패 1건');

    // sync_failed 도메인에도 개별 링크가 있어야 한다
    await expect(banner.getByTestId('domain-alert-link-cdn.school.kr')).toBeVisible();
  });

  test('TLS 만료 + sync_failed 혼합 알림 시 각 타입별로 개별 링크가 표시된다', async ({ page }) => {
    await mockApi(page, 'GET', '/proxy/status', createProxyStatusOnline());
    await mockApi(page, 'GET', '/proxy/requests', []);
    await mockApi(page, 'GET', '/domains/summary', {
      ...createDomainSummary(),
      alerts: [
        { type: 'tls_expiring', host: 'textbook.com' },
        { type: 'sync_failed', host: 'cdn.school.kr' },
      ],
    });
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/tls/certificates', []);

    await page.goto('/domains');

    const banner = page.getByTestId('domain-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('TLS 만료 임박 1건');
    await expect(banner).toContainText('동기화 실패 1건');

    // 혼합 타입에서도 각 도메인에 개별 링크가 있어야 한다 (#101 핵심 — 첫 번째만 링크되던 버그)
    await expect(banner.getByTestId('domain-alert-link-textbook.com')).toBeVisible();
    await expect(banner.getByTestId('domain-alert-link-cdn.school.kr')).toBeVisible();
  });
});

/**
 * 이슈 #126 회귀 방지 — DomainTable 빈 상태(검색/필터) CTA 버튼 미제공
 * 검색 결과 없음 빈 상태에 "검색어 지우기" 버튼, 필터 결과 없음 빈 상태에 "전체 보기" 버튼이
 * 표시되어 사용자가 바로 상태를 초기화할 수 있어야 한다.
 *
 * 모킹 이유: 검색어/필터 적용 시 빈 배열 반환 조건을 확정적으로 재현하기 위함.
 * mock이 재현하는 조건: 검색/필터 API 응답이 빈 배열인 상황(실제 서버 데이터 무관).
 * 이 mock이 실제 버그 조건과 동일한 이유: DomainTable은 domains prop이 빈 배열이고
 * searchQuery 또는 enabledFilter prop이 있을 때 해당 빈 상태를 렌더링하므로,
 * mock 응답이 실제 렌더링 경로를 그대로 따른다.
 */
test.describe('도메인 관리 — 빈 상태 CTA (#126)', () => {
  test('검색 결과 없음 빈 상태에 "검색어 지우기" CTA 버튼이 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=xxxxxxnotexist', []);

    await page.goto('/domains');

    await page.getByTestId('domain-search').fill('xxxxxxnotexist');

    // 검색 결과 없음 빈 상태에 CTA 버튼이 표시되어야 한다 (#126 핵심)
    await expect(page.getByTestId('domains-empty-search')).toBeVisible();
    await expect(page.getByTestId('empty-clear-search-btn')).toBeVisible();
    await expect(page.getByTestId('empty-clear-search-btn')).toContainText('검색어 지우기');
  });

  test('검색 결과 없음 빈 상태에서 "검색어 지우기" 클릭 시 검색어가 초기화되고 전체 목록이 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?q=xxxxxxnotexist', []);

    await page.goto('/domains');

    // 검색어 입력 → 빈 상태 진입
    await page.getByTestId('domain-search').fill('xxxxxxnotexist');
    await expect(page.getByTestId('domains-empty-search')).toBeVisible();

    // CTA 클릭 → 검색 초기화 (#126 핵심 — 입력→처리→출력 파이프라인)
    await page.getByTestId('empty-clear-search-btn').click();

    // 검색어가 지워지고 전체 도메인 목록이 다시 표시되어야 한다
    await expect(page.getByTestId('domain-search')).toHaveValue('');
    await expect(page.getByTestId('domains-table')).toBeVisible();
    await expect(page.getByTestId('domains-empty-search')).not.toBeVisible();
  });

  test('필터 결과 없음 빈 상태에 "전체 보기" CTA 버튼이 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains');

    // 비활성 필터 선택 → 빈 상태 진입
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '비활성', exact: true }).click();

    // 필터 결과 없음 빈 상태에 CTA 버튼이 표시되어야 한다 (#126 핵심)
    await expect(page.getByTestId('domains-empty-filter')).toBeVisible();
    await expect(page.getByTestId('empty-clear-filter-btn')).toBeVisible();
    await expect(page.getByTestId('empty-clear-filter-btn')).toContainText('전체 보기');
  });

  test('필터 결과 없음 빈 상태에서 "전체 보기" 클릭 시 필터가 해제되고 전체 목록이 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains');

    // 비활성 필터 선택 → 빈 상태 진입
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '비활성', exact: true }).click();
    await expect(page.getByTestId('domains-empty-filter')).toBeVisible();

    // CTA 클릭 → 필터 해제 (#126 핵심 — 입력→처리→출력 파이프라인)
    await page.getByTestId('empty-clear-filter-btn').click();

    // 필터가 해제되어 전체 도메인 목록이 다시 표시되어야 한다
    await expect(page.getByTestId('domains-table')).toBeVisible();
    await expect(page.getByTestId('domains-empty-filter')).not.toBeVisible();
  });
});

/**
 * 이슈 #119 회귀 방지 — 필터 변경 시 선택 상태 미초기화로 숨겨진 도메인 일괄 삭제 가능
 * 도메인을 선택한 뒤 검색/필터를 변경하면 선택이 초기화되어
 * 현재 뷰에 표시되지 않는 도메인이 일괄 삭제 대상에 포함되지 않아야 한다.
 *
 * 모킹 이유: 검색어 변경 시 API 응답을 확정적으로 제어하기 위함.
 * mock이 재현하는 조건: textbook.com을 선택한 상태에서 q=cdn으로 필터 변경 시
 *   일괄 삭제 툴바에 선택 카운트가 0이 되어야 한다.
 * 이 mock이 실제 버그 조건과 동일한 이유: DomainsPage의 selectedHosts는 useState로 관리되므로
 *   필터 변경 시 초기화 로직이 없으면 숨겨진 도메인이 선택 상태로 남는다.
 */
test.describe('도메인 관리 — 필터 변경 시 선택 초기화 (#119)', () => {
  test('검색어를 변경하면 이전에 선택한 도메인의 선택 상태가 초기화된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    // 검색어 'cdn' 적용 시 cdn.school.kr만 반환하는 시나리오
    await mockApi(page, 'GET', '/domains?q=cdn', [
      {
        host: 'cdn.school.kr',
        origin: 'https://cdn.school.kr',
        enabled: 1,
        description: '',
        created_at: 1700000100,
        updated_at: 1700000100,
      },
    ]);

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // textbook.com 체크박스 선택 → 일괄 삭제 버튼 활성화
    await page.getByTestId('domain-select-textbook.com').check();
    const bulkDeleteBtn = page.getByTestId('toolbar-bulk-delete-btn');
    await expect(bulkDeleteBtn).not.toBeDisabled();
    await expect(bulkDeleteBtn).toContainText('(1)');

    // 검색어 입력으로 필터 변경 → textbook.com이 뷰에서 사라짐
    await page.getByTestId('domain-search').fill('cdn');
    await page.waitForTimeout(400);

    // 필터 변경 후 선택이 초기화되어 일괄 삭제 버튼이 다시 disabled가 되어야 한다 (#119 핵심)
    await expect(bulkDeleteBtn).toBeDisabled();
    await expect(bulkDeleteBtn).not.toContainText('(1)');
  });

  test('활성/비활성 필터를 변경하면 선택 상태가 초기화된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    await mockApi(page, 'GET', '/domains?enabled=false', []);

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // textbook.com 체크박스 선택 → 일괄 삭제 버튼 활성화
    await page.getByTestId('domain-select-textbook.com').check();
    const bulkDeleteBtn = page.getByTestId('toolbar-bulk-delete-btn');
    await expect(bulkDeleteBtn).not.toBeDisabled();

    // 비활성 필터 선택 → 필터 변경으로 선택 초기화
    await page.getByTestId('domain-enabled-filter').click();
    await page.getByRole('listbox').getByRole('option', { name: '비활성', exact: true }).click();

    // 필터 변경 후 선택이 초기화되어 일괄 삭제 버튼이 disabled가 되어야 한다 (#119 핵심)
    await expect(bulkDeleteBtn).toBeDisabled();
  });
});

/**
 * 이슈 #107 회귀 방지 — DomainBulkAddDialog shadcn Textarea 컴포넌트 사용
 * raw <textarea>가 아닌 shadcn Textarea 컴포넌트를 사용해야 하며,
 * focus-visible:ring-2 클래스(Input과 동일한 포커스 링 굵기)가 적용되어야 한다.
 */
test.describe('도메인 관리 — 일괄 추가 Textarea 컴포넌트 (#107)', () => {
  test('일괄 추가 다이얼로그 Textarea에 shadcn 포커스 링 클래스가 적용된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // shadcn Textarea — focus-visible:ring-2 클래스 존재 확인 (#107 핵심)
    const textarea = page.getByTestId('bulk-add-textarea');
    await expect(textarea).toBeVisible();

    const className = await textarea.evaluate((el) => el.className);
    // raw <textarea>의 수동 복제 클래스 'focus:ring-1' 이 없어야 한다
    expect(className).not.toContain('focus:ring-1');
    // shadcn 표준 포커스 링 패턴이 적용되어야 한다
    expect(className).toContain('focus-visible:ring-2');
  });

  test('일괄 추가 Textarea에 텍스트 입력 후 제출하면 API가 호출된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    // POST /domains/bulk 모킹
    let bulkAddCalled = false;
    await page.route('**/api/domains/bulk', (route) => {
      bulkAddCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.goto('/domains');

    // 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // Textarea에 유효한 입력 후 제출
    await page.getByTestId('bulk-add-textarea').fill('textbook.com https://textbook.com');
    await page.getByTestId('bulk-add-submit').click();

    // API가 호출되었는지 확인 — 입력→처리→출력 파이프라인 검증 (#107)
    await page.waitForTimeout(200);
    expect(bulkAddCalled).toBe(true);
  });
});

/**
 * 이슈 #143 회귀 방지 — DomainToolbar 검색 debounce timer unmount 시 cleanup 누락
 * 검색 입력 중 다른 페이지로 이동하면 debounce 타이머가 정리되어야 한다.
 * unmount 후 stale onFilterChange 콜백이 실행되어선 안 된다.
 */
test.describe('도메인 관리 — 검색 debounce unmount cleanup (#143)', () => {
  test('검색 입력 중 다른 페이지로 이동해도 stale API 요청이 발생하지 않는다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    // /dns 페이지 이동 후 발생할 수 있는 stale 검색 요청 감시
    // — unmount cleanup이 없으면 debounce 300ms 후 이전 쿼리로 API 요청이 발생한다 (#143)
    let staleSearchCalled = false;
    await page.route('**/api/domains?q=stale**', () => {
      staleSearchCalled = true;
    });

    // DNS 페이지 전환에 필요한 기본 mock
    await page.route('**/api/dns/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/domains');

    // 검색 입력 — debounce(300ms) 완료 전에 페이지 이동
    await page.getByTestId('domain-search').fill('stale');

    // debounce 완료(300ms) 이전에 즉시 다른 페이지로 이동 — unmount 트리거
    await page.goto('/dns');

    // debounce 300ms 경과 후 stale 콜백 실행 여부 확인
    // cleanup이 없으면 이 시점에 /api/domains?q=stale 요청이 발생한다 (#143)
    await page.waitForTimeout(500);

    expect(staleSearchCalled).toBe(false);
  });
});

/**
 * 이슈 #212 회귀 방지 — 도메인 일괄 삭제 부분 실패 분리 안내
 * 서버 응답 shape: { deleted, requested, missing }.
 * deleted < requested 또는 missing 이 비어있지 않으면 warning 토스트로 누락 host 를 안내해야 한다.
 *
 * 모킹 이유: 다른 세션에서 선삭제된 상황(부분 실패)을 결정적으로 재현하려면
 * 서버 응답을 고정해야 한다. mock 이 재현하는 조건: DELETE /api/domains/bulk 가
 * { deleted: 1, requested: 2, missing: ['gone.com'] } 을 반환하는 상황.
 * 이 mock 이 실제 버그 조건과 동일한 이유: 훅은 응답 shape 만 보고 토스트를 분기하므로
 * mock 응답으로 분기 동작을 정확히 검증할 수 있다.
 */
test.describe('도메인 관리 — 일괄 삭제 부분 실패 분리 안내 (#212)', () => {
  test('deleted < requested 시 warning 토스트가 누락 host 를 표시한다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    // DELETE /api/domains/bulk — 부분 실패 응답 모킹
    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            deleted: 1,
            requested: 2,
            missing: ['cdn.school.kr'],
          }),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 두 개의 호스트 선택 후 일괄 삭제 트리거
    await page.getByTestId('domain-select-textbook.com').check();
    await page.getByTestId('domain-select-cdn.school.kr').check();
    await page.getByTestId('toolbar-bulk-delete-btn').click();
    await expect(page.getByTestId('bulk-delete-dialog')).toBeVisible();
    await page.getByTestId('bulk-delete-confirm').click();

    // sonner warning 토스트에 "요청 2건 중 1건만 삭제" + 누락 host 가 포함되어야 한다
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('요청 2건 중 1건만 삭제');
    await expect(toast).toContainText('cdn.school.kr');
  });

  test('전부 성공 시 기존 success 토스트 유지', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ deleted: 1, requested: 1, missing: [] }),
        });
      } else {
        return route.fallback();
      }
    });

    await page.goto('/domains');
    await page.getByTestId('domain-select-textbook.com').check();
    await page.getByTestId('toolbar-bulk-delete-btn').click();
    await expect(page.getByTestId('bulk-delete-dialog')).toBeVisible();
    await page.getByTestId('bulk-delete-confirm').click();

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('1건이 삭제되었습니다');
  });
});

/**
 * 이슈 #219 회귀 방지 — DomainBulkAddDialog 큰 입력 시 줄 수/도메인 개수 미리보기
 * 1000줄 등 대량 입력을 붙여넣었을 때 사용자가 등록 예정 개수를 즉시 인지할 수 있어야 한다.
 * - textarea 아래 미리보기 텍스트(`bulk-add-preview`)에 "N줄 / 도메인 M개" 표시
 * - 제출 버튼 라벨이 동적으로 "일괄 추가 (M건)"으로 변경
 */
test.describe('도메인 관리 — 일괄 추가 미리보기 (#219)', () => {
  test('빈 입력일 때는 안내 문구가 보이고 제출 버튼은 정적 라벨이다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 빈 입력일 때 미리보기 안내 + 제출 버튼 정적 라벨
    await expect(page.getByTestId('bulk-add-preview')).toHaveText('입력된 도메인이 없습니다');
    await expect(page.getByTestId('bulk-add-submit')).toHaveText('일괄 추가');
  });

  test('여러 줄 입력 시 줄 수/도메인 개수 미리보기와 동적 버튼 라벨이 표시된다 (#219)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 3줄 입력 (모두 유효한 도메인 형식, 빈 줄 없음)
    await page
      .getByTestId('bulk-add-textarea')
      .fill('a.example.com https://a.example.com\nb.example.com https://b.example.com\nc.example.com https://c.example.com');

    // 줄 수와 도메인 개수가 정확히 표시되어야 한다 (#219 핵심)
    await expect(page.getByTestId('bulk-add-preview')).toHaveText('3줄 / 도메인 3개');
    // 제출 버튼 라벨이 동적으로 변경되어야 한다 (#219 핵심)
    await expect(page.getByTestId('bulk-add-submit')).toHaveText('일괄 추가 (3건)');
  });

  test('빈 줄이 섞인 입력은 줄 수와 도메인 개수가 분리되어 표시된다 (#219)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 5줄(빈 줄 2개 포함) — 도메인 줄은 3개
    await page
      .getByTestId('bulk-add-textarea')
      .fill('a.example.com https://a.example.com\n\nb.example.com https://b.example.com\n\nc.example.com https://c.example.com');

    // 전체 줄 수 5, 도메인 줄 3 — 두 지표가 별도로 표시되어 사용자가 트림된 결과를 인지할 수 있다
    await expect(page.getByTestId('bulk-add-preview')).toHaveText('5줄 / 도메인 3개');
    await expect(page.getByTestId('bulk-add-submit')).toHaveText('일괄 추가 (3건)');
  });

  /**
   * 이슈 #255 회귀 방지 — Textarea 글자수/줄수 가드 없음
   * 기존: 4만 줄(1.4MB) 입력도 그대로 수용되어 미리보기/제출 버튼이 활성화됨.
   * 수정 후: maxLength로 입력 단계 hard cap + 줄 수 상한 초과 시 인라인 에러 + 버튼 disabled.
   *
   * mock 정당성: 클라이언트 가드가 차단해 서버 호출이 발생하지 않음을 검증하기 위해 POST 모킹.
   * mock이 재현하는 조건: parseLines()가 줄 수 상한 초과 시 parseError 설정.
   */
  test('Textarea에 maxLength가 적용되어 64KB 초과 입력은 잘려 들어간다 (#255)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // textarea의 maxLength 속성이 65536(64KB)으로 설정되었는지 검증 — 입력 단계 hard cap (#255 핵심)
    const maxLength = await page
      .getByTestId('bulk-add-textarea')
      .evaluate((el) => (el as HTMLTextAreaElement).maxLength);
    expect(maxLength).toBe(65536);
  });

  test('500줄 초과 입력은 미리보기에 한도 안내 + 제출 버튼이 비활성화된다 (#255)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    let bulkAddCalled = false;
    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'POST') {
        bulkAddCalled = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ added: 0, skipped: [], failed: [] }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 501줄 입력 (한도 500 초과) — 짧은 더미 라인으로 textarea maxLength 64KB 안에 들어가도록
    const lines = Array.from({ length: 501 }, (_, i) => `h${i}.example.com https://h${i}.example.com`).join('\n');
    await page.getByTestId('bulk-add-textarea').fill(lines);

    // 미리보기에 한도 안내가 함께 표시되어야 한다
    await expect(page.getByTestId('bulk-add-preview')).toContainText('최대 500줄');

    // 제출 버튼은 비활성화되어 사용자 클릭 자체를 차단 (#255 핵심)
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled();

    // 서버 호출이 발생하지 않아야 한다
    expect(bulkAddCalled).toBe(false);
  });

  test('500줄 초과 상태에서 제출 시도해도 인라인 에러가 표시되고 POST 차단 (#255)', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    let bulkAddCalled = false;
    await page.route('**/api/domains/bulk', async (route) => {
      if (route.request().method() === 'POST') {
        bulkAddCalled = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ added: 0, skipped: [], failed: [] }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/domains');
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 501줄 입력 — 한도 초과
    const lines = Array.from({ length: 501 }, (_, i) => `h${i}.example.com https://h${i}.example.com`).join('\n');
    await page.getByTestId('bulk-add-textarea').fill(lines);

    // 버튼이 disabled 이지만, force click 으로 우회 시도해도 핸들러가 차단해야 한다
    await page.getByTestId('bulk-add-submit').click({ force: true });

    // POST는 호출되지 않아야 한다 — disabled 가드가 정상 동작
    expect(bulkAddCalled).toBe(false);
  });
});

/**
 * 이슈 #346 — DomainTable '요청(24h)'·'캐시 히트' 셀 표시
 * 회귀 방지: by_domain[]의 host와 매칭되는 행은 실제 값을 표시하고,
 * 매칭되지 않는 행은 '—' placeholder를 유지해야 한다.
 *
 * 모킹 이유: 실제 백엔드의 by_domain 통계 값은 트래픽에 따라 변동하므로 확정적
 * 검증이 어렵다. /api/cache/stats 응답을 고정 값으로 모킹해 셀 출력값을 확정한다.
 * mock이 재현하는 시나리오: textbook.com은 by_domain에 포함(요청 1234, edge_hit_rate 0.821),
 * cdn.school.kr은 미포함 → 후자는 '—' 유지.
 * 이 mock이 실제 버그 조건과 동일한 이유: 버그는 by_domain 데이터 유무와 무관하게 항상
 * '—'를 출력하던 것이었으므로, mock 데이터 매칭 행에서 실제 값이 보이는 것을 확인하면
 * "데이터가 있어도 표시되지 않는" 원래 버그가 회귀하지 않았음을 검증할 수 있다.
 */
test.describe('도메인 관리 — 요청(24h)·캐시 히트 셀 표시 (#346 회귀 방지)', () => {
  test('by_domain 매칭 행은 요청수/엣지 히트율을 표시하고, 미매칭 행은 — 유지', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());
    // textbook.com만 by_domain에 포함 — cdn.school.kr은 누락 시나리오
    await mockApi(page, 'GET', '/cache/stats', createCacheStats({
      by_domain: [
        {
          host: 'textbook.com',
          requests: 1234,
          l1_hits: 800,
          l2_hits: 213,
          bypass_total: 50,
          l1_hit_rate: 800 / 1234,
          edge_hit_rate: 1013 / 1234, // ≈ 0.821 → 82.1%
        },
      ],
    }));

    await page.goto('/domains');
    await expect(page.getByTestId('domains-table')).toBeVisible();

    // 매칭 행: 천 단위 구분자 적용된 요청수 + 백분율 1자리 히트율 표시
    const matchedRow = page.getByTestId('domain-row-textbook.com');
    await expect(matchedRow).toContainText('1,234');
    await expect(matchedRow).toContainText('82.1%');

    // 미매칭 행: '—' placeholder 유지 (캐시 히트율 컬럼이 두 번째 — placeholder)
    const unmatchedRow = page.getByTestId('domain-row-cdn.school.kr');
    // 매칭 행은 '1,234'/'82.1%'라 '—'가 없어야 하지만, 미매칭 행에는 두 셀 모두 '—'가 있어야 한다.
    const dashCount = await unmatchedRow.locator('td').filter({ hasText: /^—$/ }).count();
    expect(dashCount).toBeGreaterThanOrEqual(2);
  });
});
