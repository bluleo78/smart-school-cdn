import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    [
      'monocart-reporter',
      {
        name: 'Admin Web E2E Coverage',
        outputFile: 'coverage/index.html',
        coverage: {
          // V8 커버리지 수집 대상: 로컬 dev 서버 URL만 포함
          entryFilter: (entry: { url: string }) =>
            entry.url.includes('localhost:4173'),
          // 소스 필터: 앱 소스만 포함 (.tsx/.ts/.mjs, node_modules·chunk 제외)
          sourceFilter: (sourcePath: string) =>
            /\.(tsx|ts|mjs)$/.test(sourcePath) &&
            !sourcePath.includes('node_modules') &&
            !sourcePath.startsWith('chunk-'),
          reports: [
            ['v8'],
            ['lcov', { outputFile: 'coverage/lcov.info' }],
            ['console-summary'],
            ['json', { outputFile: 'coverage/coverage.json' }],
          ],
        },
      },
    ],
  ],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
