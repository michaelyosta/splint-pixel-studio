import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT || 5190);
export default defineConfig({
  testDir: './e2e',
  globalSetup: './scripts/e2e-global-setup.mjs',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile iPhone', use: { ...devices['iPhone 13'] } },
    { name: 'Mobile Pixel', use: { ...devices['Pixel 5'] } },
  ],
});
