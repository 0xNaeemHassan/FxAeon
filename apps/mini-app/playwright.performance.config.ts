import { defineConfig, devices } from '@playwright/test';

/** Isolated timings use the esbuild ActionReview harness and never trigger the
 * static application build. The browser-route measurement expects the local
 * dev server at 4331; the deterministic harness measurement does not. */
export default defineConfig({
  testDir: './e2e/specs',
  testMatch: 'performance-measurement.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.PERFORMANCE_BASE_URL ?? 'http://localhost:4331',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
