import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../../scripts/e2e_browser_channel.cjs';

// Match the other isolated Playwright harnesses by default (bundled Chromium).
// An installed desktop browser can be selected locally without changing CI.
const browserChannel = configuredBrowserChannel(process.env, 'PRIVY_SEND_HARNESS_CHANNEL');

export default defineConfig({
  testDir: './specs',
  testMatch: 'privy-send-adapter.spec.ts',
  outputDir: './.privy-send-harness-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    viewport: { width: 1024, height: 768 },
    ...(browserChannel ? { launchOptions: { channel: browserChannel } } : {}),
  },
});
