import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E + visual-regression for the FxAeon Telegram Mini App.
 *
 * The app is a Telegram Mini App: every screen depends on `window.Telegram.WebApp`
 * and on the authenticated bot API (`/api/v1/miniapp/*`). Neither is real in a
 * test, so the suite (see e2e/fixtures/) injects a deterministic WebApp shim and
 * intercepts every API call with fixtures — exercising the real page logic
 * (routing, quote/gas/confirm flow, degraded states) without a chain, a bot, or
 * Privy.
 *
 * `webServer` builds + serves the static export on a FIXED port so the baked
 * NEXT_PUBLIC_BOT_API_URL is same-origin (no CORS) and Playwright can fulfil the
 * fetches itself. See e2e/serve.mjs.
 */
const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Functional specs live in e2e/specs, visual snapshots in e2e/visual.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  // Pixel-stable defaults for visual regression: a fixed mobile viewport,
  // scale 1, reduced motion, and a deterministic locale/timezone.
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Container-safe Chromium launch (CI runners / sandboxes without a usable
    // kernel sandbox or with small /dev/shm).
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },

  // Snapshot tolerance: allow sub-pixel anti-aliasing noise, catch real diffs.
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },

  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        // Pin viewport/scale regardless of the device profile so baselines are
        // reproducible across machines.
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
    },
  ],

  webServer: {
    command: 'node e2e/serve.mjs',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      NEXT_PUBLIC_BOT_API_URL: BASE_URL,
      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: 'FxAeonBot',
      NEXT_PUBLIC_PRIVY_APP_ID: '',
    },
  },
});
