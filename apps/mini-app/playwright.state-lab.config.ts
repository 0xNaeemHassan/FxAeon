import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.UI_STATE_LAB_PORT ?? 4322);
const baseURL = `http://127.0.0.1:${port}`;

/** Isolated from the production E2E config: only the in-memory state-lab server runs. */
export default defineConfig({
  testDir: './e2e/state-lab',
  testMatch: 'spec.ts',
  snapshotPathTemplate: '{testDir}/state-lab-snapshots/{arg}-{projectName}-{platform}{ext}',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: './test-results/ui-state-lab-playwright',
  projects: [{
    name: 'chromium-windows',
    use: {
      ...devices['Desktop Chrome'],
      baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      locale: 'en-US',
      timezoneId: 'UTC',
      launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    },
  }],
  webServer: {
    command: 'node e2e/ui-state-lab-server.mjs',
    url: baseURL,
    reuseExistingServer: process.env.UI_STATE_LAB_REUSE_SERVER === '1' && !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { UI_STATE_LAB_PORT: String(port) },
  },
});
