import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT || 5190);
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';
const reporter = process.env.CI
  ? [
      ['line'],
      ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || 'test-results/results.json' }],
    ]
  : undefined;
export default defineConfig({
  testDir: './e2e',
  globalSetup: './scripts/e2e-global-setup.mjs',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  outputDir,
  reporter,
  preserveOutput: 'always',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile iPhone', use: { ...devices['iPhone 13'] } },
    { name: 'Mobile Pixel', use: { ...devices['Pixel 5'] } },
  ],
});
