import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/borrow-selection-entry.tsx');

const mocks: Record<string, string> = {
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>;`,
  '@/components/TokenIcon': `import React from 'react'; export default () => <span />;`,
  '@/components/ConnectWalletButton': `import React from 'react'; export default ({children}) => <button>{children}</button>;`,
  '@/components/ProductUI': `import React from 'react'; export const MetricRows = ({rows}) => <div>{rows.map((row) => <div key={row.label}>{row.label}: {row.value}</div>)}</div>; export const PageHeading = ({title}) => <h1>{title}</h1>; export const ProductNav = () => null; export const ProductSurface = ({children, ...props}) => <section {...props}>{children}</section>; export const StatusNotice = ({title, children}) => <div role="status">{title} {children}</div>;`,
  '@/lib/displayPrices': `export const freshDisplayPrices = () => ({});`,
  '@/lib/fx/nativeMax': `export const calculateNativeMax = async () => 0n;`,
  '@/lib/fx': `export const estimatePlannedRouteCost = async () => ({}); export async function planDepositAndMint(){ globalThis.__borrowHarness.plannerCount += 1; return {}; } export async function planRepayAndWithdraw(){ globalThis.__borrowHarness.plannerCount += 1; return {}; } export const restoreSignatureRequiredDraftFromSearch = () => undefined; export const signatureDraftIdFromSearch = () => undefined; export const assertConfiguredPublicClientChain = () => {}; export const assertPublicClientChain = () => {}; export const getEthereumClient = () => ({}); export const getFxReadFacade = () => ({});`,
  '@/lib/fx/readFacade': `export const FX_READ_DEADLINE_MS = 1; export const withReadDeadline = (promise) => promise;`,
  '@/lib/fx/policy': `export const positionPoolAddress = () => '0x0000000000000000000000000000000000000001';`,
  '@/components/ActionReview': `import React from 'react'; import { usePrivyWallet } from '@/lib/wallet'; export const ActionReview = ({planBuilder, label, editor}) => { const wallet = usePrivyWallet(); return <>{editor}<button type="button" onClick={async () => { globalThis.__borrowHarness.reviewAttemptCount += 1; if (planBuilder) { const route = await planBuilder(); if (route) await wallet.sendTransaction({}); } }}>{label}</button></>; };`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => globalThis.__borrowHarness.shared;`,
  '@/components/ProtocolPositionCard': `import React from 'react'; export const ProtocolPositionNotice = ({status}) => status === 'unavailable' ? <div role="status">Positions are temporarily unavailable</div> : null;`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/components/ProtocolForm': `import React from 'react'; export const AmountField = ({label, value, onChange}) => <label>{label}<input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>; export const Segmented = ({options, value, onChange, ariaLabel}) => <div role="group" aria-label={ariaLabel}>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; export const TokenSelect = () => null; export const useWalletTokenBalances = () => ({ balances: {}, status: 'ready', refresh: async () => {} });`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({ status: 'unavailable', prices: {} });`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ ...globalThis.__borrowHarness.wallet, isEmbedded: false, wallets: [], sendTransaction: async () => { globalThis.__borrowHarness.walletRequestCount += 1; } });`,
  '@/lib/positionValuation': `export const calculatePositionUsdValuation = () => ({collateralUsdCents: null, debtUsdCents: null, netEquityUsdCents: null}); export const formatUsdCents = () => '—';`,
  '@/lib/prices': `export const priceKeyForSymbol = () => null;`,
  '@/lib/transactionState': `export const resetTransactionAmounts = () => ({deposit:'',mint:'',repay:'',withdraw:''});`,
  '@/components/MissingValue': `import React from 'react'; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@aladdindao/fx-sdk': `export const tokens = { eth: '0x0000000000000000000000000000000000000001', weth: '0x0000000000000000000000000000000000000002', stETH: '0x0000000000000000000000000000000000000003', wstETH: '0x0000000000000000000000000000000000000004', WBTC: '0x0000000000000000000000000000000000000005', usdc: '0x0000000000000000000000000000000000000006', usdt: '0x0000000000000000000000000000000000000007', fxUSD: '0x0000000000000000000000000000000000000008', fxUSDBasePool: '0x0000000000000000000000000000000000000009' };`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'borrow-browser-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, namespace: 'empty-css' };
        if (existsSync(candidate)) return { path: candidate };
        for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
        return { path: candidate };
      });
      build.onResolve({ filter: /^@aladdindao\/fx-sdk$/ }, () => ({ path: '@aladdindao/fx-sdk', namespace: 'mock' }));
      build.onResolve({ filter: /^\.\/(directPositionDiscovery|canonicalPositionReader)$/ }, (args: { path: string }) => ({ path: args.path, namespace: 'position-read-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'position-read-mock' }, (args: { path: string }) => ({ contents: args.path === './directPositionDiscovery' ? 'export const discoverDirectWalletPositionIds = async () => []; export const readDirectWalletPositionCount = async () => 0;' : 'export const readCanonicalPositionContext = async () => ({}); export const readCanonicalPositionInfo = async () => ({});', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args: { path: string; resolveDir?: string }) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });

type BorrowHarnessControl = {
  wallet: { ready: boolean; authenticated: boolean; address?: string; chainId: number; connectionVersion: number };
  shared: { walletAddress: string | null; positions: object[]; status: string; failedGroups: Array<{ market: string; side: string; reason: unknown }>; lastVerifiedAt: number | null; [key: string]: unknown };
  plannerCount: number;
  walletRequestCount: number;
  reviewAttemptCount: number;
  rerender?: () => void;
};

async function mount(page: import('@playwright/test').Page) {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByText('Earn', { exact: true })).toBeVisible();
}

async function changeSnapshot(page: import('@playwright/test').Page, update: (harness: BorrowHarnessControl) => void) {
  await page.evaluate((callbackSource) => {
    const harness = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    (0, eval)(`(${callbackSource})(globalThis.__borrowHarness)`);
    harness.rerender?.();
  }, update.toString());
}

test('same-wallet disappearance removes the selected position and review action', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeVisible();

  await changeSnapshot(page, (harness) => {
    harness.shared = { ...harness.shared, positions: [], status: 'ready', failedGroups: [], lastVerifiedAt: Date.now() };
  });
  await expect(page.getByText('ETH position #17')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toHaveCount(0);
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 0, walletRequests: 0 });
});

test('new-position planning remains available while existing-position discovery is unavailable', async ({ page }) => {
  await mount(page);
  await changeSnapshot(page, (harness) => {
    harness.shared = {
      ...harness.shared,
      positions: [],
      status: 'unavailable',
      failedGroups: [{ market: 'ETH', side: 'long', reason: 'read timeout' }],
      lastVerifiedAt: null,
    };
  });
  const workspace = page.getByTestId('borrow-workspace-card');
  await expect(workspace.getByText('Positions are temporarily unavailable')).toHaveCount(0);
  await workspace.getByLabel('Starting collateral').fill('1');
  await workspace.getByLabel('fxUSD to borrow').fill('10');
  await workspace.getByRole('button', { name: 'Review borrowing' }).click();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 1, walletRequests: 1 });
  await workspace.getByRole('button', { name: 'Your positions' }).click();
  await expect(workspace.getByRole('status')).toContainText('Positions are temporarily unavailable');
});

test('mounted Borrow page prevents review planning and wallet requests when selection becomes stale', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await page.getByRole('button', { name: 'Borrow more' }).click();
  await expect(page.getByRole('button', { name: 'Review borrowing' })).toBeVisible();
  await page.getByLabel('Additional fxUSD to borrow').fill('10');
  const review = page.getByRole('button', { name: 'Review borrowing' });
  await expect(review).toBeVisible();
  await review.click();
  const freshCounters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { attempts: h.reviewAttemptCount, planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(freshCounters).toEqual({ attempts: 1, planners: 1, walletRequests: 1 });

  await changeSnapshot(page, (harness) => { harness.shared = { ...harness.shared, status: 'partial', failedGroups: [{ market: 'ETH', side: 'long', reason: 'read timeout' }] }; });
  await review.click();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { attempts: h.reviewAttemptCount, planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ attempts: 2, planners: 1, walletRequests: 1 });
});

test('mounted Borrow page removes a selection when its provider snapshot changes accounts', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Your positions' }).click();
  await expect(page.getByText('ETH position #17')).toBeVisible();
  await changeSnapshot(page, (harness) => {
    harness.wallet = { ...harness.wallet, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', connectionVersion: 2 };
  });
  await expect(page.getByText('ETH position #17')).toHaveCount(0);
  await expect(page.getByText('Borrow fxUSD', { exact: true })).toBeVisible();
  const counters = await page.evaluate(() => {
    const h = (window as Window & { __borrowHarness: BorrowHarnessControl }).__borrowHarness;
    return { planners: h.plannerCount, walletRequests: h.walletRequestCount };
  });
  expect(counters).toEqual({ planners: 0, walletRequests: 0 });
});
