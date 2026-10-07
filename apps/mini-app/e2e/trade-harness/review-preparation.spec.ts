import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Real Trade, ActionReview, service, patched SDK, route policy, simulation and
// fee hooks. Only the wallet/display providers and transport responses are
// deterministic fixtures. No connector, wallet signature or live RPC is used.
const require = createRequire(resolve(__dirname, 'review-preparation.spec.ts'));
const { buildHarness } = require('./long-review-build.cjs') as { buildHarness: () => Promise<{ script: string; css: string }> };
const { createFixture } = require('./long-review-rpc.cjs') as { createFixture: (options: Record<string, unknown>) => {
  rpc: (request: unknown) => Promise<unknown>;
  block: { number: string };
} };
let bundle: { script: string; css: string };
test.beforeAll(async () => { bundle = await buildHarness(); });

type Control = {
  wallet: { ready: boolean; authenticated: boolean; isEmbedded: boolean; address: string; chainId: number; connectionVersion: number };
  events: Array<{ name: string; start: number; end?: number; error?: string }>;
  rerender?: () => void;
  trace: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
  enabledConfirmSeen: boolean;
};
async function mount(page: Page, options: { delayMs?: number; blockDelayMs?: number; funded?: boolean; simulationFailureIndex?: number } = {}) {
  const fixture = createFixture({ delayMs: options.delayMs ?? 20, ethBalance: options.funded ? 10n ** 20n : 400000000000000n, simulationFailureIndex: options.simulationFailureIndex });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/gas')) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 20));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'etherscan', chainId: 1, gasPriceWei: '3000000000', baseFeePerGasWei: '1000000000', tiers: { standard: '3000000000', fast: '4000000000', rapid: '5000000000' }, fetchedAt: Date.now(), stale: false }) });
    }
    if (url.includes('fake-controlled-fixture')) {
      const request = route.request().postDataJSON();
      if (request.method === 'eth_blockNumber' && options.blockDelayMs) await new Promise((resolve) => setTimeout(resolve, options.blockDelayMs));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixture.rpc(request)) });
    }
    if (url.startsWith('http://long-review.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
    return route.abort();
  });
  await page.goto('http://long-review.test/trade');
  await page.evaluate(() => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: {} };
    const h: Control = {
      wallet: { ready: true, authenticated: true, isEmbedded: true, address: '0x1111111111111111111111111111111111111111', chainId: 1, connectionVersion: 1 },
      events: [], enabledConfirmSeen: false,
      async trace(name, fn) {
        const event: Control['events'][number] = { name, start: performance.now() }; h.events.push(event);
        try { return await fn(); } catch (cause) { event.error = String(cause); throw cause; } finally { event.end = performance.now(); }
      },
    };
    (globalThis as typeof globalThis & { __longReview: Control }).__longReview = h;
    new MutationObserver(() => {
      if (Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Confirm' && !button.disabled)) h.enabledConfirmSeen = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
  // Let the initial bounds read settle so this test isolates click/preparation.
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'readLeverageBounds' && event.end !== undefined))).toBe(true);
  return fixture;
}
async function fill(page: Page, amount = '0.0003') {
  await page.getByRole('textbox', { name: 'Amount in ETH' }).fill(amount);
  await page.getByRole('slider').fill('2.8');
}
async function planCount(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.filter((event) => event.name === 'planIncreasePosition').length);
}
async function review(page: Page) { await page.getByRole('button', { name: 'Review ETH Long', exact: true }).click(); }
async function insufficient(page: Page) { await expect(page.getByRole('button', { name: 'Not enough ETH for network fees', exact: true })).toBeDisabled(); }

test('quick review presents entered facts immediately and starts only one plan', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await expect(page.getByRole('button', { name: 'Checking transaction…', exact: true })).toBeDisabled();
  await expect(page.getByText('0.0003 ETH', { exact: true })).toBeVisible();
  await page.waitForTimeout(400); expect(await planCount(page)).toBe(1);
  await insufficient(page);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.enabledConfirmSeen)).toBe(false);
});

test('click during the advisory block read prevents a late duplicate warm-up', async ({ page }) => {
  await mount(page, { blockDelayMs: 350 }); await fill(page);
  await page.waitForTimeout(260); await review(page); await insufficient(page);
  expect(await planCount(page)).toBe(1);
});

test('a matching in-flight prefetch remains reusable through explicit review', async ({ page }) => {
  await mount(page); await fill(page);
  await expect.poll(() => planCount(page)).toBe(1);
  await review(page); await insufficient(page); expect(await planCount(page)).toBe(1);
});

test('a completed warm quote still needs current-block validation and simulation', async ({ page }) => {
  await mount(page); await fill(page);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'planIncreasePosition' && event.end !== undefined))).toBe(true);
  await review(page); await insufficient(page); expect(await planCount(page)).toBe(1);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.filter((event) => event.name === 'prepareRoutesForReview').length)).toBe(1);
});

test('a changed block discards the warmed plan and prepares a fresh one', async ({ page }) => {
  const fixture = await mount(page); await fill(page);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __longReview: Control }).__longReview.events.some((event) => event.name === 'planIncreasePosition' && event.end !== undefined))).toBe(true);
  fixture.block.number = '0x1312d01'; await review(page); await insufficient(page); expect(await planCount(page)).toBe(2);
});

test('Edit abandons preparation and late results cannot reopen review', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.0003');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Review ETH Long', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
});

test('wallet change abandons the old preparation', async ({ page }) => {
  await mount(page); await fill(page); await review(page);
  await page.evaluate(() => { const h = (globalThis as typeof globalThis & { __longReview: Control }).__longReview; h.wallet = { ...h.wallet, address: '0x2222222222222222222222222222222222222222', connectionVersion: 2 }; h.rerender?.(); });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
});

test('fresh-cache visibility refresh disables confirmation until the request settles', async ({ page }) => {
  await mount(page, { funded: true, delayMs: 100 }); await fill(page); await review(page);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true }); await expect(confirm).toBeEnabled();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Checking network fees…', exact: true })).toBeDisabled();
  await expect(confirm).toBeEnabled();
});
