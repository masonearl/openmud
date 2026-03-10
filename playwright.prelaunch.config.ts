import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-web',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4303',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'python3 -m http.server 4303 --directory web',
    url: 'http://127.0.0.1:4303',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
