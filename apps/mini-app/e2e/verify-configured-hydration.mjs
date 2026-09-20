/**
 * Configured-provider hydration regression check (does not sign in).
 * Start the normal Next dev server with NEXT_PUBLIC_PRIVY_APP_ID configured,
 * then run `node e2e/verify-configured-hydration.mjs` from apps/mini-app.
 * The regular static E2E build intentionally has no Privy app ID and cannot
 * exercise this provider branch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.FXAEON_HYDRATION_BASE_URL ?? 'http://localhost:4321';
const targetTheme = process.env.FXAEON_HYDRATION_THEME ?? 'light';
if (!['official', 'dark', 'light'].includes(targetTheme)) {
  throw new Error('FXAEON_HYDRATION_THEME must be official, dark, or light.');
}
const envFile = resolve(process.cwd(), '.env.local');
let localEnv = '';
try {
  localEnv = readFileSync(envFile, 'utf8');
} catch {
  // Shell-provided NEXT_PUBLIC_PRIVY_APP_ID is also accepted.
}
const fileAppId = localEnv.match(/^NEXT_PUBLIC_PRIVY_APP_ID\s*=\s*(.+)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, '');
if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID && !fileAppId) {
  throw new Error('Set NEXT_PUBLIC_PRIVY_APP_ID in the environment or apps/mini-app/.env.local before running this configured-provider check.');
}

const routes = ['/', '/trade', '/positions'];
const browser = await chromium.launch({ headless: true });
let failures = 0;

try {
  for (const route of routes) {
    const page = await browser.newPage();
    const startedAt = Date.now();
    await page.addInitScript((theme) => localStorage.setItem('fxaeon_theme_id_v2', theme), targetTheme);
    const hydrationWarnings = [];
    const pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrated|server rendered HTML/i.test(message.text())) {
        hydrationWarnings.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const response = await page.goto(new URL(route, baseUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
      await page.locator(`[data-route="${route}"]`).first().waitFor({ state: 'attached', timeout: 20_000 });
      // This CTA only replaces its server-rendered loading state after the
      // client wallet provider is ready, so it prevents a false pass against
      // static HTML before delayed dynamic chunks finish hydrating.
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().waitFor({ state: 'visible', timeout: 45_000 });
      const providerReadyMs = Date.now() - startedAt;
      // Allow late selective hydration to report any attribute mismatch before
      // recording a pass; the previous issue appeared after the CTA was ready.
      await page.waitForTimeout(3_000);
      if (await page.locator('html').getAttribute('data-theme') !== targetTheme) {
        throw new Error(`saved ${targetTheme} palette was not applied`);
      }
      if (route === '/trade') {
        const inputAsset = page.getByLabel('Input asset');
        await inputAsset.waitFor({ state: 'visible', timeout: 10_000 });
        if (!(await inputAsset.isEnabled())) throw new Error('Input asset picker is disabled after provider readiness');
        await inputAsset.click();
        await page.getByRole('dialog', { name: 'Input asset', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
      }
      if (hydrationWarnings.length || pageErrors.length) {
        throw new Error(`${hydrationWarnings.length} hydration warning(s), ${pageErrors.length} page error(s)`);
      }
      console.log(`PASS ${route}: configured Privy hydration is clean (${providerReadyMs}ms to provider-ready; 3000ms post-ready observation)`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${route}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (failures) process.exitCode = 1;
