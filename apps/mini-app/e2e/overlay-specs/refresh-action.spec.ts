import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = resolve(__dirname, '../..');
const tsxPackage = createRequire(resolve(root, 'package.json')).resolve('tsx/package.json');
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'e2e/harness/refresh-action-entry.tsx');
let bundle = '';

test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
  });
  bundle = result.outputFiles[0].text;
});

async function mount(page: Page) {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Refresh wallet data' })).toBeVisible();
}

async function calls(page: Page, identity: string, reader: string): Promise<number> {
  return page.evaluate(({ identity: wallet, reader: name }) => {
    const harness = (window as Window & { __refreshActionHarness?: { calls: Record<string, number> } }).__refreshActionHarness;
    return harness?.calls[`${wallet}:${name}`] ?? 0;
  }, { identity, reader });
}

async function settle(page: Page, identity: string, reader: string, outcome: 'resolve' | 'reject') {
  await page.evaluate(({ wallet, name, result }) => {
    const harness = (window as Window & { __refreshActionHarness?: { settle: (id: string, reader: 'portfolio' | 'activity' | 'positions', value: 'resolve' | 'reject') => void } }).__refreshActionHarness!;
    harness.settle(wallet, name as 'portfolio' | 'activity' | 'positions', result);
  }, { wallet: identity, name: reader, result: outcome });
}

test('refresh fans out, coalesces duplicate taps, and stays busy through a slow reader after a failure', async ({ page }) => {
  await mount(page);
  const refresh = page.getByRole('button', { name: 'Refresh wallet data' });
  await refresh.click();
  await refresh.click();

  for (const reader of ['portfolio', 'activity', 'positions']) {
    await expect.poll(() => calls(page, 'wallet-A', reader)).toBe(1);
  }
  const state = page.getByTestId('refresh-state');
  await expect(state).toHaveText('Refreshing');

  // The activity reader rejects, but the aggregate should remain busy until
  // every other reader has completed.
  await settle(page, 'wallet-A', 'portfolio', 'resolve');
  await expect(state).toHaveText('Refreshing');
  await settle(page, 'wallet-A', 'positions', 'resolve');
  await expect(state).toHaveText('Idle');
  for (const reader of ['portfolio', 'activity', 'positions']) {
    expect(await calls(page, 'wallet-A', reader)).toBe(1);
  }
});

test('a new wallet gets a fresh refresh and an old completion cannot clear its spinner', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Refresh wallet data' }).click();
  await expect.poll(() => calls(page, 'wallet-A', 'positions')).toBe(1);
  await page.getByRole('button', { name: 'Change wallet' }).click();
  await expect(page.getByTestId('identity')).toHaveText('wallet-B');
  await expect(page.getByTestId('refresh-state')).toHaveText('Idle');

  await page.getByRole('button', { name: 'Allow activity reader' }).click();
  await page.getByRole('button', { name: 'Refresh wallet data' }).click();
  await expect.poll(() => calls(page, 'wallet-B', 'positions')).toBe(1);
  const state = page.getByTestId('refresh-state');
  await expect(state).toHaveText('Refreshing');

  await settle(page, 'wallet-A', 'portfolio', 'resolve');
  await settle(page, 'wallet-A', 'positions', 'resolve');
  await expect(state).toHaveText('Refreshing');

  for (const reader of ['portfolio', 'activity', 'positions']) await settle(page, 'wallet-B', reader, 'resolve');
  await expect(state).toHaveText('Idle');
  for (const reader of ['portfolio', 'activity', 'positions']) {
    expect(await calls(page, 'wallet-B', reader)).toBe(1);
  }
});
