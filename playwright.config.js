import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testDbPath = resolve(__dirname, 'e2e', 'test.db.bin');

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev',
      port: 5173,
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      command: 'npm.cmd --prefix server run dev',
      url: 'http://localhost:3001/health',
      timeout: 30000,
      reuseExistingServer: false,
      env: {
        SQLITE_DB_PATH: testDbPath,
        RATE_LIMIT_MAX: '1000',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile iPhone', use: { ...devices['iPhone 13'] } },
    { name: 'Mobile Pixel', use: { ...devices['Pixel 5'] } },
  ],
});
