import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT || 5173);
const apiPort = Number(process.env.E2E_API_PORT || 3001);

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `npm.cmd run dev -- --port ${webPort}`,
      port: webPort,
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/run-e2e-api.mjs',
      url: `http://localhost:${apiPort}/health`,
      timeout: 30000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile iPhone', use: { ...devices['iPhone 13'] } },
    { name: 'Mobile Pixel', use: { ...devices['Pixel 5'] } },
  ],
});
