import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './positions-harness',
  outputDir: './.positions-harness-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { ...devices['Pixel 7'], headless: true, viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 },
});
