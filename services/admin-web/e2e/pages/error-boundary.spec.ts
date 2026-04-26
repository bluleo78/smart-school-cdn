/// ErrorBoundary E2E 테스트
/// 렌더 중 예외 발생 시 전체 앱이 화이트스크린으로 크래시되지 않고
/// 폴백 UI(안내 문구 + 복귀 버튼)가 표시되는지 검증한다.
/// DEV 전용 라우트 /__e2e/throw 를 사용하여 강제 렌더 오류를 유도한다.
import { test, expect } from '../fixtures/test';

test.describe('ErrorBoundary — 렌더 예외 처리', () => {
  test('렌더 중 예외 발생 시 폴백 UI가 표시된다', async ({ page }) => {
    // /__e2e/throw 라우트로 이동 — ThrowOnRender 컴포넌트가 즉시 예외를 throw한다
    // ErrorBoundary가 없으면 전체 앱이 언마운트되어 흰 화면만 보임
    // 입력: 렌더 예외 | 처리: ErrorBoundary.getDerivedStateFromError | 출력: 폴백 UI
    await page.goto('/__e2e/throw');

    // 폴백 UI — 오류 안내 문구와 복귀 버튼이 표시되어야 한다
    const fallback = page.getByTestId('error-boundary-fallback');
    await expect(fallback).toBeVisible({ timeout: 5000 });
    await expect(fallback.getByText('오류가 발생했습니다.', { exact: true })).toBeVisible();
    await expect(fallback.getByText('예기치 않은 오류가 발생했습니다. 새로고침하거나 대시보드로 돌아가 주세요.')).toBeVisible();
  });

  test('폴백 UI — 대시보드로 돌아가기 버튼이 표시된다', async ({ page }) => {
    await page.goto('/__e2e/throw');

    // 폴백 UI가 표시될 때까지 대기
    await expect(page.getByTestId('error-boundary-fallback')).toBeVisible({ timeout: 5000 });

    // 복귀 버튼이 두 개 모두 표시되는지 확인
    await expect(page.getByTestId('error-boundary-home-btn')).toBeVisible();
    await expect(page.getByTestId('error-boundary-reload-btn')).toBeVisible();
  });

  test('폴백 UI — 대시보드로 돌아가기 클릭 시 홈(/)으로 이동한다', async ({ page }) => {
    await page.goto('/__e2e/throw');

    await expect(page.getByTestId('error-boundary-fallback')).toBeVisible({ timeout: 5000 });

    // 대시보드 복귀 버튼 클릭 → href="/" 하드 네비게이션으로 트리 완전 재마운트
    // 입력: 복귀 버튼 클릭 | 처리: window.location 변경 | 출력: 홈(/)으로 이동
    await page.getByTestId('error-boundary-home-btn').click();
    await expect(page).toHaveURL('/');
  });
});
