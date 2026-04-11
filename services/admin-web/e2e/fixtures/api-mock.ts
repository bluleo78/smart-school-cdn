/// API 모킹 헬퍼
/// page.route()를 사용하여 백엔드 없이 프론트엔드를 독립 테스트한다.
import type { Page } from '@playwright/test';

/** API 경로를 모킹하여 지정된 JSON 데이터를 반환한다 */
export async function mockApi(
  page: Page,
  method: string,
  path: string,
  data: unknown,
  options?: { delay?: number },
) {
  await page.route(`**/api${path.startsWith('/') ? path : '/' + path}`, async (route) => {
    // 메서드가 일치하지 않으면 원래대로 처리
    if (route.request().method() !== method) {
      return route.fallback();
    }

    // 지연 옵션이 있으면 대기 (로딩 상태 테스트용)
    if (options?.delay) {
      await new Promise((r) => setTimeout(r, options.delay));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}
