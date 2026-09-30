import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './borrow-harness',
  outputDir: './.borrow-harness-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], headless: true, viewport: { width: 1100, height: 850 } },
});
