import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { performance } from 'node:perf_hooks';

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
      if (h.previewDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, h.previewDelayMs));
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
      const result = { status: h.partialResult ? 'partial' : 'confirmed', operation: route.operation, chainId: route.chainId, walletAddress: route.walletAddress, steps: [{ index: 0, transaction: route.transactions[0], status: 'confirmed', hash }] };
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
        sendTransaction: async () => { h.sendCount += 1; if (h.deferWalletResponse) { h.deferWalletResponse = false; await new Promise((resolve) => h.walletResolvers.push(resolve)); } return { hash: '0x1111111111111111111111111111111111111111111111111111111111111111' }; },
      };
    }
  `,
  '@/components/WalletDataProvider': `
export const useInvalidateWalletData = () => async () => {
      const h = globalThis.__actionReviewHarness;
      h.refreshStarted = true;
      h.rerender?.();
      if (h.deferRefresh) await new Promise((resolve) => h.refreshResolvers.push(resolve));
      if (h.refreshDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, h.refreshDelayMs));
      h.accountRefreshCount += 1;
      h.rerender?.();
    };
  `,
  '@/lib/walletDataRefresh': `export const createRouteWalletRefresh = (invalidate) => async (route) => invalidate(route.walletAddress, route.chainId);`,
  '@/lib/taskState': `export const selectExecutionTask = () => null;`,
  '@/lib/receiptPresentation': `export const buildReceiptPresentation = () => ({ movements: [], technicalMovements: [], executionFee: null, feeLabel: 'Network fee', feeCaveat: null, nativeValue: null }); export const receiptTransfersFromLogs = () => [];`,
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
  '@/components/review/executionResult': `export const resultPresentation = (result) => result.status === 'partial' ? ({ title: 'Partially completed', body: 'An earlier step confirmed before the action stopped.', tone: 'warning', icon: () => null }) : ({ title: 'Confirmed', body: 'Mock confirmed.', tone: 'success', icon: () => null }); export const resultBodyDuringRefresh = ({ status, refreshing, positionAction, body }) => status === 'confirmed' && refreshing && positionAction ? 'Transaction confirmed. Position details are refreshing.' : body;`,
  '@/lib/fx/reviewFormatting': `export const rawQuoteReviewFacts = () => []; export const routeFinancialReviewFacts = () => [];`,
  'lucide-react': `
    import React from 'react';
    const Icon = (props) => <span {...props} />;
    export const AlertTriangle = Icon; export const ArrowLeft = Icon; export const CheckCircle2 = Icon; export const CircleAlert = Icon;
    export const Clock3 = Icon; export const LoaderCircle = Icon; export const ShieldCheck = Icon; export const ExternalLink = Icon;
    export const Circle = Icon; export const XCircle = Icon;
  `,
};

export async function buildHarness(): Promise<string> {
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

let cachedBundle = '';

export async function openHarness(page: Page, options: { initialPreviewMode?: 'auto' | 'deferred'; previewDelayMs?: number; refreshDelayMs?: number } = {}): Promise<number> {
  if (!cachedBundle) cachedBundle = await buildHarness();
  const startedAt = performance.now();
  const initialOptions = { mode: options.initialPreviewMode, previewDelayMs: options.previewDelayMs ?? 0, refreshDelayMs: options.refreshDelayMs ?? 0 };
  const modePrelude = `<script>globalThis.__actionReviewHarnessInitialOptions = ${JSON.stringify(initialOptions)};</script>`;
  await page.setContent(`<div id="root"></div>${modePrelude}<script>${cachedBundle}</script>`);
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
  return startedAt;
}

export async function metric(page: Page, key: 'prepare' | 'plan' | 'runner' | 'send' | 'draftSave'): Promise<number> {
  return page.evaluate((metricKey) => {
    const harness = (window as typeof window & { __actionReviewHarness?: Record<string, number> }).__actionReviewHarness;
    return harness?.[`${metricKey}Count`] ?? 0;
  }, key);
}
