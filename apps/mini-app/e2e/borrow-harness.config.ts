import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';

const browserChannel = configuredBrowserChannel();

export default defineConfig({
  testDir: './borrow-harness',
  outputDir: './.borrow-harness-results',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], headless: true, viewport: { width: 1100, height: 850 }, ...(browserChannel ? { launchOptions: { channel: browserChannel } } : {}) },
});
