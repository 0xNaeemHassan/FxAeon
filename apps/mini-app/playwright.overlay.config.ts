import { defineConfig, devices } from '@playwright/test';
import { configuredBrowserChannel } from '../../scripts/e2e_browser_channel.cjs';

const browserChannel = configuredBrowserChannel();

export default defineConfig({
  testDir: './e2e/overlay-specs',
  outputDir: './test-results/overlay-playwright',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.OVERLAY_TEST_BASE_URL ?? 'http://localhost:4331',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'], ...(browserChannel ? { channel: browserChannel } : {}) },
  },
});
