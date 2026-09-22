import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'apps/mini-app/e2e/harness/action-review-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mocks: Record<string, string> = {
  '@/lib/fx': `
    const H = () => globalThis.__actionReviewHarness;
    export const FX_TOKENS = { fxUSD: { address: '0x00000000000000000000000000000000000000c1' }, fxSAVE: { address: '0x00000000000000000000000000000000000000c2' } };
    export const formatRouteGasCost = () => ({ gasFee: '', totalCost: '' });
    export const useRouteGasCost = () => ({ estimate: null, estimateIsCurrent: false, status: 'idle' });
    export async function prepareRoutesForReview(planned, walletAddress) {
      const h = H(); h.prepareCount += 1;
      if (h.failNextPrepare) { h.failNextPrepare = false; throw new Error('mock preview failure'); }
      const route = Array.isArray(planned) ? planned[0] : planned;
      if (h.mode === 'deferred') return new Promise((resolve) => {
        const request = {
          id: h.nextPreviewRequestId++,
          routeVersion: route.harnessRouteVersion,
          routeType: route.details?.routeType ?? '',
          routeWalletAddress: route.walletAddress?.toLowerCase() ?? '',
          previewWalletAddress: walletAddress?.toLowerCase() ?? '',
          connectionVersion: route.harnessConnectionVersion,
          settled: false,
          resolve: () => {
            if (request.settled) return;
            request.settled = true;
            resolve({ viable: [route], failures: [] });
          },
        };
        h.previewRequests.push(request);
      });
      return { viable: [route], failures: [] };
    }
    export async function runTransactionRoute({ route, callbacks }) {
      const h = H(); h.runnerCount += 1;
      h.lastExecutedRouteVersion = route.harnessRouteVersion;
      if (h.deferRunner) { h.deferRunner = false; await new Promise((resolve) => h.executionResolvers.push(resolve)); }
      if (h.failRunner) { h.failRunner = false; throw new Error('mock execution failure'); }
      callbacks.onStatus?.('submitted', 'mock submitted');
      const hash = await callbacks.requestSignature(route.transactions[0]);
      callbacks.onStep?.({ index: 0, transaction: route.transactions[0], status: 'confirmed', hash });
      callbacks.onStatus?.('confirmed', 'mock confirmed');
      const result = { status: 'confirmed', operation: route.operation, chainId: route.chainId, walletAddress: route.walletAddress, steps: [{ index: 0, transaction: route.transactions[0], status: 'confirmed', hash }] };
      await callbacks.postConfirmRead?.(route, result);
      return result;
    }
    export const saveSignatureRequiredDraft = () => { const h = H(); h.draftSaveCount += 1; return { id: 'mock-draft' }; };
    export const removeSignatureRequiredDraft = () => {};
    export const cancelSignatureRequiredDraft = () => {};
  `,
  '@/lib/wallet': `
    export function usePrivyWallet() {
      const h = globalThis.__actionReviewHarness;
      return { ...h.wallet, isEmbedded: false, wallets: [], selectedWallet: undefined,
        connect: async () => { h.wallet = { ready: true, authenticated: true, connectionVersion: h.wallet.connectionVersion + 1, address: '0x00000000000000000000000000000000000000aa', chainId: 1 }; h.rerender?.(); },
        disconnect: async () => {}, selectWallet: () => {}, switchChain: async () => {},
        sendTransaction: async () => { h.sendCount += 1; return { hash: '0x1111111111111111111111111111111111111111111111111111111111111111' }; },
      };
    }
  `,
  '@/components/WalletDataProvider': `
    export const useInvalidateWalletData = () => async () => {
      const h = globalThis.__actionReviewHarness;
      h.refreshStarted = true;
      h.rerender?.();
      if (h.deferRefresh) await new Promise((resolve) => h.refreshResolvers.push(resolve));
    };
  `,
  '@/lib/walletDataRefresh': `export const createRouteWalletRefresh = (invalidate) => async (route) => invalidate(route.walletAddress, route.chainId);`,
  '@/lib/telegram': `export const haptic = () => {}; export const openExternalLink = () => false;`,
  '@/components/ui': `
    import React, { forwardRef } from 'react';
    export const Card = ({ children, className = '' }) => <div className={className}>{children}</div>;
    export const Button = forwardRef(({ children, onClick, disabled, loading, className = '', ...props }, ref) => <button ref={ref} type="button" {...props} disabled={disabled || loading} onClick={onClick} className={className}>{children}</button>);
  `,
  '@/components/ConnectWalletButton': `
    import React from 'react';
    import { usePrivyWallet } from '@/lib/wallet';
    export default function ConnectWalletButton({ children, onConnectStart, onConnected, onConnectError, ...props }) {
      const wallet = usePrivyWallet();
      return <button type="button" {...props} onClick={async () => { onConnectStart?.(); try { await wallet.connect(); await onConnected?.(); } catch { onConnectError?.(); } }}>{children}</button>;
    }
  `,
  '@/lib/errors': `export const userSafeError = (cause, fallback) => cause instanceof Error ? cause.message : fallback;`,
  '@/lib/transactionProgress': `
    export const hasTransactionHash = (step) => Boolean(step?.hash);
    export const transactionStepProgress = () => ({ state: 'confirmed', label: 'Confirmed' });
    export const confirmedUpdateCopy = () => ({ label: 'Confirmed', body: 'Mock confirmed.' });
  `,
  '@/components/BridgeTracker': `export const BridgeTracker = () => null;`,
  '@/components/review/ReviewProgress': `
    import React from 'react';
    export const chainName = (id) => id === 8453 ? 'Base' : 'Ethereum';
    export const stepProgress = () => ({ label: 'Confirmed', className: '', icon: null });
    export const CalldataDisclosure = ({ data }) => <div><button type="button">Copy</button><pre>{data}</pre></div>;
    export const StatusNotice = ({ label, body }) => <div role="status"><strong>{label}</strong><span>{body}</span></div>;
    export const InlineError = ({ message }) => <div role="alert">{message}</div>;
    export const TransactionHashLink = () => null;
  `,
  '@/components/review/executionResult': `export const resultPresentation = () => ({ title: 'Confirmed', body: 'Mock confirmed.', tone: 'success', icon: () => null });`,
  '@/lib/fx/reviewFormatting': `export const rawQuoteReviewFacts = () => []; export const routeFinancialReviewFacts = () => [];`,
  'lucide-react': `
    import React from 'react';
    const Icon = (props) => <span {...props} />;
    export const AlertTriangle = Icon; export const ArrowLeft = Icon; export const CheckCircle2 = Icon; export const CircleAlert = Icon;
    export const Clock3 = Icon; export const LoaderCircle = Icon; export const ShieldCheck = Icon; export const ExternalLink = Icon;
    export const Circle = Icon; export const XCircle = Icon;
  `,
};

async function buildHarness(): Promise<string> {
  type EsbuildPluginBuild = {
    onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
    onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
  };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{
      name: 'action-review-harness-mocks',
      setup(build: EsbuildPluginBuild) {
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          if (existsSync(candidate)) return { path: candidate };
          for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
          return { path: candidate };
        });
        build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'lucide-react', namespace: 'mock' }));
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
        build.onResolve({ filter: /\.module\.css$/ }, (args: { path: string; resolveDir?: string }) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
        build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';

type PreviewRequestSnapshot = {
  id: number;
  routeVersion: number;
  routeType: string;
  routeWalletAddress: string;
  previewWalletAddress: string;
  connectionVersion: number;
  settled: boolean;
};

async function openHarness(page: import('@playwright/test').Page, options: { initialPreviewMode?: 'auto' | 'deferred' } = {}): Promise<void> {
  const modePrelude = options.initialPreviewMode
    ? `<script>globalThis.__actionReviewHarnessInitialMode = ${JSON.stringify(options.initialPreviewMode)};</script>`
    : '';
  await page.setContent(`<div id="root"></div>${modePrelude}<script>${bundle}</script>`);
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
}

async function previewRequests(page: import('@playwright/test').Page): Promise<PreviewRequestSnapshot[]> {
  return page.evaluate(() => {
    const harness = (window as typeof window & { __actionReviewHarness?: { previewRequests?: PreviewRequestSnapshot[] } }).__actionReviewHarness;
    return (harness?.previewRequests ?? []).map(({ id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled }) => ({
      id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled,
    }));
  });
}

async function resolvePreviewRequest(page: import('@playwright/test').Page, requestId: number): Promise<void> {
  const resolved = await page.evaluate((id) => {
    const harness = (window as typeof window & {
      __actionReviewHarness?: { previewRequests?: Array<{ id: number; settled: boolean; resolve: () => void }> };
    }).__actionReviewHarness;
    const request = harness?.previewRequests?.find((candidate) => candidate.id === id);
    if (!request || request.settled) return false;
    request.resolve();
    return true;
  }, requestId);
  expect(resolved, `preview request ${requestId} should be pending before resolution`).toBe(true);
}

async function expectNoEnabledCurrentAction(page: import('@playwright/test').Page): Promise<void> {
  const currentAction = page.getByRole('button', { name: 'Open position v2', exact: true });
  await expect(currentAction.and(page.locator('button:not(:disabled)'))).toHaveCount(0);
  expect(await metric(page, 'runner')).toBe(0);
  expect(await metric(page, 'send')).toBe(0);
}

async function metric(page: import('@playwright/test').Page, key: 'prepare' | 'plan' | 'runner' | 'send' | 'draftSave'): Promise<number> {
  return page.evaluate((metricKey) => {
    const harness = (window as typeof window & { __actionReviewHarness?: Record<string, number> }).__actionReviewHarness;
    return harness?.[`${metricKey}Count`] ?? 0;
  }, key);
}

test.describe('ActionReview isolated orchestration', () => {
  test.beforeAll(async () => { bundle = await buildHarness(); });

  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
    const review = page.getByRole('button', { name: 'Review position', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
    await expect(confirm).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });


  test('connect and preview never sign, then one direct primary click runs once', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    const actionDetails = page.locator('section[aria-label="Review details"]');
    await expect(actionDetails).toBeVisible();
    const quoteDetails = actionDetails.locator('details').filter({ hasText: /^Quote details/ }).first();
    await expect(quoteDetails).toHaveCount(1);
    await quoteDetails.locator('summary').click();
    await expect(quoteDetails.getByText('Route', { exact: true })).toBeVisible();
    await expect(quoteDetails.getByText('Terms 1', { exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('ignores stale preview completion after terms and account changes', async ({ page }) => {
    const account = '0x00000000000000000000000000000000000000aa';
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await expect.poll(() => metric(page, 'prepare')).toBe(1);

    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 1
      && !request.settled
    ))).toBe(true);
    const original = (await previewRequests(page)).find((request) => request.routeVersion === 1 && request.connectionVersion === 1);
    expect(original).toMatchObject({
      routeVersion: 1,
      routeType: 'Terms 1',
      routeWalletAddress: account,
      previewWalletAddress: account,
      connectionVersion: 1,
      settled: false,
    });

    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await resolvePreviewRequest(page, original!.id);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
    await expectNoEnabledCurrentAction(page);

    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 2
      && request.routeType === 'Terms 2'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 2
      && !request.settled
    ))).toBe(true);
    const requests = await previewRequests(page);
    const activeRequests = requests.filter((request) => (
      request.routeVersion === 2
      && request.routeType === 'Terms 2'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 2
      && !request.settled
    ));
    expect(activeRequests).toHaveLength(1);
    const active = activeRequests[0]!;
    expect(await metric(page, 'prepare')).toBe(requests.length);
    expect(active.id).toBe(requests.length);

    // Terms can schedule an intermediate preview before the wallet change is
    // committed. Resolve any such request by its captured identity, never FIFO.
    const intermediate = requests.filter((request) => (
      request.id !== original!.id
      && request.id !== active.id
      && !request.settled
    ));
    for (const request of intermediate) {
      await resolvePreviewRequest(page, request.id);
      await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
      await expectNoEnabledCurrentAction(page);
    }

    expect(active).toMatchObject({
      routeVersion: 2,
      routeType: 'Terms 2',
      routeWalletAddress: account,
      previewWalletAddress: account,
      connectionVersion: 2,
      settled: false,
    });
    await resolvePreviewRequest(page, active.id);
    const currentAction = page.getByRole('button', { name: 'Open position v2', exact: true });
    await expect(currentAction).toBeVisible();
    await expect(currentAction).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('uses the simulated visible route if the planner changes after the quote', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change planner after quote', exact: true }).click();
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('blocks a preview whose refresh is still pending after its 30-second freshness window', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    // Let the debounced first quote finish under the fake clock before
    // switching the harness to defer the subsequent background refresh.
    await page.clock.runFor(500);
    const action = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });
    await expect(action).toBeEnabled();
    await expect.poll(() => metric(page, 'plan')).toBe(1);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await page.getByRole('button', { name: 'Defer preview', exact: true }).click();

    // Initial preview starts after a short debounce, so advance past the full
    // refresh interval measured from that first route's preparation time.
    await page.clock.runFor(16_000);
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.routeWalletAddress === '0x00000000000000000000000000000000000000aa'
      && request.previewWalletAddress === '0x00000000000000000000000000000000000000aa'
      && request.connectionVersion === 1
      && !request.settled
    ))).toBe(true);
    const refresh = (await previewRequests(page)).find((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.connectionVersion === 1
      && !request.settled
    ));
    expect(refresh?.settled).toBe(false);
    await page.clock.runFor(15_000);

    await expect(action).toBeDisabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await resolvePreviewRequest(page, refresh!.id);
    await expect(action).toBeEnabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('expires a resumed legacy review and refreshes before enabling confirmation', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Resume legacy review', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
    await expect(confirm).toBeVisible({ timeout: 2_000 });
    await expect(confirm).toBeEnabled();
    await expect.poll(() => metric(page, 'plan')).toBe(1);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);

    await page.clock.runFor(31_000);
    // Flush a zero-delay freshness callback if React committed the review
    // effect at the end of the same fake-clock advancement.
    await page.clock.runFor(1);
    await expect(confirm).toHaveCount(0);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    const action = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(action).toBeVisible();
    await expect(action).toBeEnabled({ timeout: 5_000 });
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('persists a resume hint only when the wallet request starts', async ({ page }) => {
    await openHarness(page);
    const action = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });

    await page.getByRole('button', { name: 'Fail before wallet request', exact: true }).click();
    await action.click();
    await expect(page.getByRole('alert')).toContainText('mock execution failure');
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    expect(await metric(page, 'draftSave')).toBe(0);

    await action.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(1);
  });

  test('exposes Try again after preview failure and recovers without signing', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Fail next preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position v2', exact: true })).toBeVisible({ timeout: 2_000 });
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('drops a deferred execution after the account changes before the wallet request', async ({ page }) => {
    await openHarness(page);
    const primary = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(primary).toBeVisible({ timeout: 2_000 });
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Defer before wallet request', exact: true }).click();
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await primary.click();
    await expect.poll(() => metric(page, 'runner')).toBe(1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve execution', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });
});
