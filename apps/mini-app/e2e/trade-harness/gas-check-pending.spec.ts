import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { GasPendingHarness } from '../harness/gas-check-pending-entry';

const appRoot = resolve(__dirname, '../..');
const fxSrc = resolve(appRoot, 'src/lib/fx');
const require = createRequire(resolve(appRoot, 'package.json'));
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};

// Exercise the real shared cache and React hook with deferred transport calls.
// No SDK, wallet connection, live RPC, or generated bundle is required.
const relativeMocks: Record<string, string> = {
  './clients': `
    export const assertPublicClientChain = async (client, expected) => {
      if (await client.getChainId() !== expected) throw new Error('wrong client chain');
    };
    export const getPublicClient = () => { throw new Error('unexpected default public client'); };
  `,
  './etherscanGas': `export const fetchEthereumGasFallback = async () => { throw new Error('unexpected gas fallback'); };`,
  './gasFeePolicy': `export const formatGasPriceGwei = () => ''; export const validateGasTierQuote = (quote) => quote;`,
};

let bundle = '';
test.beforeAll(async () => {
  const built = await esbuild.build({
    entryPoints: [resolve(appRoot, 'e2e/harness/gas-check-pending-entry.tsx')],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: appRoot,
    plugins: [{
      name: 'gas-pending-transport-fixture',
      setup(build: {
        onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
        onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => unknown) => void;
      }) {
        build.onResolve({ filter: /^\.\// }, (args) => (
          args.resolveDir === fxSrc && relativeMocks[args.path]
            ? { path: args.path, namespace: 'gas-pending-mock' }
            : undefined
        ));
        build.onLoad({ filter: /.*/, namespace: 'gas-pending-mock' }, (args) => ({ contents: relativeMocks[args.path], loader: 'js' }));
      },
    }],
  });
  bundle = built.outputFiles[0].text;
});

async function requestCount(page: Page) {
  return page.evaluate(() => {
    const harness: GasPendingHarness = window.__gasPendingHarness;
    return harness.requests.length;
  });
}

async function mount(page: Page) {
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => requestCount(page)).toBe(1);
  await expect(page.getByTestId('checking')).toHaveText('true');
}

async function resolveGas(page: Page, index: number, gas: string) {
  await page.evaluate(({ index, gas }) => window.__gasPendingHarness.requests[index].resolve(BigInt(gas)), { index, gas });
}

async function prime(page: Page) {
  await mount(page);
  await resolveGas(page, 0, '21000');
  await expect(page.getByTestId('gas-units')).toHaveText('21000');
  await expect(page.getByTestId('checking')).toHaveText('false');
}

async function beginFreshRefresh(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => requestCount(page)).toBe(2);
  await expect(page.getByTestId('checking')).toHaveText('true');
  await expect(page.getByTestId('cache-status')).toHaveText('current');
  await expect(page.getByTestId('gas-units')).toHaveText('21000');
}

test('initial StrictMode lookup stays checking until the shared request settles', async ({ page }) => {
  await mount(page);
  await expect(page.getByTestId('cache-status')).toHaveText('refreshing');
  await expect(page.getByTestId('current')).toHaveText('false');
  await resolveGas(page, 0, '21000');
  await expect(page.getByTestId('checking')).toHaveText('false');
  await expect(page.getByTestId('current')).toHaveText('true');
  expect(await requestCount(page)).toBe(1);
});

test('a fresh cached estimate does not hide a pending visibility refresh', async ({ page }) => {
  await prime(page);
  await beginFreshRefresh(page);
  await resolveGas(page, 1, '22000');
  await expect(page.getByTestId('gas-units')).toHaveText('22000');
  await expect(page.getByTestId('checking')).toHaveText('false');
});

test('disable, settle, and re-enable does not retain an abandoned pending latch', async ({ page }) => {
  await prime(page);
  await beginFreshRefresh(page);
  await page.getByRole('button', { name: 'Toggle fee checks' }).click();
  await expect(page.getByTestId('checking')).toHaveText('false');
  await resolveGas(page, 1, '22000');
  await expect.poll(() => page.evaluate(() => window.__gasPendingHarness.cachedGas())).toBe('22000');
  await expect.poll(() => page.evaluate(() => window.__gasPendingHarness.isRefreshing())).toBe(false);
  await page.getByRole('button', { name: 'Toggle fee checks' }).click();
  await expect(page.getByTestId('gas-units')).toHaveText('22000');
  await expect(page.getByTestId('checking')).toHaveText('false');
  expect(await requestCount(page)).toBe(2);
});

test('re-enabling while a fresh-cache refresh is pending joins and receives its result', async ({ page }) => {
  await prime(page);
  await beginFreshRefresh(page);
  const toggle = page.getByRole('button', { name: 'Toggle fee checks' });
  await toggle.click();
  await expect(page.getByTestId('checking')).toHaveText('false');
  await toggle.click();
  await expect(page.getByTestId('checking')).toHaveText('true');
  expect(await requestCount(page)).toBe(2);
  await resolveGas(page, 1, '22000');
  await expect(page.getByTestId('gas-units')).toHaveText('22000');
  await expect(page.getByTestId('checking')).toHaveText('false');
});

test('a remounted consumer joins a fresh-cache refresh without duplicating transport', async ({ page }) => {
  await prime(page);
  await beginFreshRefresh(page);
  const toggle = page.getByRole('button', { name: 'Toggle consumer' });
  await toggle.click();
  await expect(page.getByTestId('checking')).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId('checking')).toHaveText('true');
  expect(await requestCount(page)).toBe(2);
  await resolveGas(page, 1, '22000');
  await expect(page.getByTestId('gas-units')).toHaveText('22000');
  await expect(page.getByTestId('checking')).toHaveText('false');
});

test('concurrent refreshes coalesce and a settled unavailable estimate stops checking', async ({ page }) => {
  await prime(page);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => requestCount(page)).toBe(2);
  await expect(page.getByTestId('checking')).toHaveText('true');
  await page.evaluate(() => window.__gasPendingHarness.requests[1].reject(new Error('controlled estimate failure')));
  await expect(page.getByTestId('estimate-status')).toHaveText('unavailable');
  await expect(page.getByTestId('current')).toHaveText('false');
  await expect(page.getByTestId('checking')).toHaveText('false');
  expect(await requestCount(page)).toBe(2);
});
