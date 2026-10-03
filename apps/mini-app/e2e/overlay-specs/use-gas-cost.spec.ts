import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const appRoot = resolve(root, 'apps/mini-app');
const src = resolve(appRoot, 'src');
const fxSrc = resolve(src, 'lib/fx');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [appRoot] });
const esbuild = createRequire(tsxPackage)('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};
const entry = resolve(appRoot, 'e2e/harness/use-gas-cost-entry.tsx');

const relativeMocks: Record<string, string> = {
  './clients': `
    export const assertPublicClientChain = async (client, expected) => {
      const actual = await client.getChainId();
      if (actual !== expected) throw new Error('wrong client chain');
    };
    export const getPublicClient = () => { throw new Error('unexpected default public client'); };
  `,
  './etherscanGas': `export const fetchEthereumGasFallback = async () => { throw new Error('unexpected gas fallback'); };`,
  './gasFeePolicy': `export const formatGasPriceGwei = () => ''; export const validateGasTierQuote = (quote) => quote;`,
};

async function buildHarness(): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    absWorkingDir: root,
    plugins: [{
      name: 'use-gas-cost-browser-harness',
      setup(build: {
        onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
        onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => unknown) => void;
      }) {
        build.onResolve({ filter: /^\.\// }, (args) => {
          if (args.resolveDir === fxSrc && relativeMocks[args.path]) return { path: args.path, namespace: 'gas-cost-mock' };
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'gas-cost-mock' }, (args) => ({ contents: relativeMocks[args.path], loader: 'js' }));
      },
    }],
  });
  const bundle = result.outputFiles.find((file) => file.text.includes('document.documentElement.dataset.harnessReady'))?.text;
  if (!bundle) throw new Error('The gas-cost hook harness bundle was not emitted.');
  return bundle;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });

async function mountHarness(page: import('@playwright/test').Page, strictMode = true) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate(({ strictMode }) => {
    (window as Window & { __gasCostHarness: { nonce: string; estimateGasCalls: number; strictMode: boolean } }).__gasCostHarness = {
      nonce: `${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-8)}`,
      estimateGasCalls: 0,
      strictMode,
    };
  }, { strictMode });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
}

test('keeps the initial StrictMode gas estimate loading until the shared RPC request resolves', async ({ page }) => {
  await mountHarness(page);
  await expect(page.getByTestId('cache-status')).toHaveText('refreshing');
  await expect.poll(() => page.evaluate(() => (window as Window & { __gasCostHarness: { estimateGasCalls: number } }).__gasCostHarness.estimateGasCalls)).toBe(1);
  await expect(page.getByTestId('current')).toHaveText('false');

  await page.evaluate(() => (window as Window & { __gasCostHarness: { resolveGas?: (value: bigint) => void } }).__gasCostHarness.resolveGas?.(21_000n));
  await expect(page.getByTestId('cache-status')).toHaveText('current');
  await expect(page.getByTestId('estimate-status')).toHaveText('current');
  await expect(page.getByTestId('current')).toHaveText('true');
  await expect(page.getByTestId('gas-units')).toHaveText('21000');
  await expect(page.getByTestId('execution-fee')).toHaveText('42000000000000');
});

test('publishes refreshing on a non-StrictMode initial cache miss before the deferred request resolves', async ({ page }) => {
  await mountHarness(page, false);
  await expect(page.getByTestId('cache-status')).toHaveText('refreshing');
  await expect.poll(() => page.evaluate(() => (window as Window & { __gasCostHarness: { estimateGasCalls: number } }).__gasCostHarness.estimateGasCalls)).toBe(1);
  await expect(page.getByTestId('current')).toHaveText('false');

  await page.evaluate(() => (window as Window & { __gasCostHarness: { resolveGas?: (value: bigint) => void } }).__gasCostHarness.resolveGas?.(21_000n));
  await expect(page.getByTestId('cache-status')).toHaveText('current');
  await expect(page.getByTestId('estimate-status')).toHaveText('current');
  await expect(page.getByTestId('current')).toHaveText('true');
  await expect(page.getByTestId('gas-units')).toHaveText('21000');
  await expect(page.getByTestId('execution-fee')).toHaveText('42000000000000');
});

test('reports unavailable after the deferred gas estimate actually rejects', async ({ page }) => {
  await mountHarness(page);
  await expect(page.getByTestId('cache-status')).toHaveText('refreshing');
  await expect.poll(() => page.evaluate(() => (window as Window & { __gasCostHarness: { estimateGasCalls: number } }).__gasCostHarness.estimateGasCalls)).toBe(1);

  const rejectType = await page.evaluate(() => {
    const rejectGas = (window as Window & { __gasCostHarness: { rejectGas?: (error: Error) => void } }).__gasCostHarness.rejectGas;
    if (!rejectGas) return 'missing';
    rejectGas(new Error('fixture RPC rejected estimate'));
    return typeof rejectGas;
  });
  expect(rejectType).toBe('function');
  await expect(page.getByTestId('cache-status')).toHaveText('current');
  await expect(page.getByTestId('estimate-status')).toHaveText('unavailable');
  await expect(page.getByTestId('current')).toHaveText('false');
});
