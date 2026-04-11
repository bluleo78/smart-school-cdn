/// Playwright 커버리지 자동 수집 픽스처
/// Chromium V8 coverage API를 사용해 테스트별 JS 커버리지를 수집하고
/// monocart-reporter의 addCoverageReport로 전달한다.
import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

/// V8 커버리지를 자동으로 수집하는 확장 test 픽스처
export const test = base.extend<{ autoCollectCoverage: void }>({
  autoCollectCoverage: [
    async ({ page }, use, testInfo) => {
      // Chromium에서만 V8 coverage API 사용 가능
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await use();
      const coverage = await page.coverage.stopJSCoverage();
      // monocart-reporter 전역 커버리지 수집기에 V8 데이터 전달
      await addCoverageReport(coverage, testInfo);
    },
    { auto: true, scope: 'test' },
  ],
});

export { expect };
