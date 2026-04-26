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
