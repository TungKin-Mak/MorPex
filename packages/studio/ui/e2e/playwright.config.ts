/**
 * MorPex v2.3 — Playwright E2E 测试配置
 *
 * 使用方式:
 *   全自动 (推荐): npx tsx scripts/run-e2e-tests.ts
 *   手动:         npx playwright test --config e2e/playwright.config.ts
 */

import { defineConfig } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  testIgnore: [],

  timeout: 60000,
  expect: { timeout: 10000 },

  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/report', open: 'never' }],
    ['json', { outputFolder: 'e2e/report', outputFile: 'results.json' }],
  ],

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        headless: process.env.HEADLESS !== 'false',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROME_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
            : {}),
        },
      },
    },
  ],

  webServer: [],

  use: {
    baseURL: FRONTEND_URL,
  },
});
