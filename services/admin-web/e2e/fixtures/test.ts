/// Playwright 커버리지 자동 수집 + 인증 자동 모킹 픽스처
/// - V8 coverage API 로 테스트별 JS 커버리지 수집 후 monocart-reporter 에 전달
/// - 모든 E2E 테스트가 RequireAuth 가드를 통과하도록 /api/auth/* 기본 모킹 자동 설치
///   (인증 흐름 검증 스펙은 fixtures/auth-mock.ts 의 mockUnauthenticated 등으로 재정의)
import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';
import { installAuthDefaults } from './auth-mock';

/// V8 커버리지 + 인증 기본 모킹을 자동 설치하는 확장 test 픽스처
export const test = base.extend<{ autoCollectCoverage: void; autoAuthMock: void }>({
  // 인증 기본 모킹 — page.goto 이전에 설치되어야 하므로 우선순위 높은 자동 픽스처
  autoAuthMock: [
    async ({ page }, use) => {
      await installAuthDefaults(page);
      await use();
    },
    { auto: true, scope: 'test' },
  ],
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
