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
    await expect(page.getByText('비활성 상태인 도메인이 없습니다.')).toBeVisible();
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
    await expect(page.getByText('활성 상태인 도메인이 없습니다.')).toBeVisible();
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

  test('빈 입력이면 "추가할 도메인을 입력해주세요." 메시지가 표시된다', async ({ page }) => {
    await setupBaseMocks(page);
    await mockApi(page, 'GET', '/domains', createDomains());

    await page.goto('/domains');

    // 일괄 추가 다이얼로그 열기
    await page.getByRole('button', { name: '일괄 추가' }).click();
    await expect(page.getByTestId('bulk-add-dialog')).toBeVisible();

    // 아무것도 입력하지 않고 제출
    await page.getByTestId('bulk-add-submit').click();

    // 빈 입력 안내 메시지가 표시되어야 한다
    const errorMsg = page.getByTestId('bulk-add-error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toHaveText('추가할 도메인을 입력해주세요.');
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
 * 이슈 #70 회귀 방지 — 토글/퍼지 버튼 뮤테이션 진행 중 disabled 미처리
 * toggleMutation 또는 purgeMutation이 isPending 상태일 때,
 * 토글/퍼지 버튼이 disabled 처리되어 중복 클릭이 불가능해야 한다.
 */
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
    // cdn.school.kr: 3일 후 만료 → '만료 3일 전' 배지
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

    // cdn.school.kr 행에 '만료 N일 전' 배지가 표시되어야 한다
    const cdnRow = page.getByTestId('domain-row-cdn.school.kr');
    await expect(cdnRow.getByText(/만료 \d+일 전/)).toBeVisible();
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
