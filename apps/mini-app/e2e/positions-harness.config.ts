import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';

const browserChannel = configuredBrowserChannel();

export default defineConfig({
  testDir: './positions-harness',
  outputDir: './.positions-harness-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { ...devices['Pixel 7'], headless: true, viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, ...(browserChannel ? { launchOptions: { channel: browserChannel } } : {}) },
});
