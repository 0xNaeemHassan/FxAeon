import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/overlay-specs',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.OVERLAY_TEST_BASE_URL ?? 'http://localhost:4331',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
