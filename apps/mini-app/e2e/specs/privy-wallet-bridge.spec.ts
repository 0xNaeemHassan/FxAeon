import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'apps/mini-app/e2e/harness/privy-wallet-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mocks: Record<string, string> = {
  '@privy-io/react-auth': `
    import { useState } from 'react';
    export function usePrivy() {
      const [, redraw] = useState(0);
      const h = globalThis.__privyHarness;
      h.adapterRerender = () => redraw((version) => version + 1);
      return { ready: h.ready, authenticated: h.authenticated };
    }
    export function useWallets() {
      const [, redraw] = useState(0);
      const h = globalThis.__privyHarness;
      h.adapterRerender = () => redraw((version) => version + 1);
      return { ready: h.ready, wallets: h.wallets };
    }
    export function useSendTransaction() { return { sendTransaction: async () => ({ hash: '0x' + '1'.repeat(64) }) }; }
    export function useLogout() { return { logout: async () => {} }; }
    export function useLogin(callbacks) { const h = globalThis.__privyHarness; h.loginCallbacks = callbacks; return { login: (options) => { h.loginCalls.push(options ?? null); } }; }
    export function useConnectWallet(callbacks) { const h = globalThis.__privyHarness; h.walletCallbacks = callbacks; return { connectWallet: () => { h.connectCalls += 1; } }; }
  `,
  '@/lib/telegram': `
    export const getInitData = () => globalThis.__privyHarness?.initData ?? '';
    export const isTelegramLaunchContext = () => Boolean(globalThis.__privyHarness?.telegram);
    export const restoreTelegramLaunchHash = () => {};
  `,
  '@/lib/fx/config': `export const assertLocalForkRpcUrl = (url) => url;`,
  './switchBrowserChain': `export const switchBrowserChain = async () => {};`,
  './eip6963': `
    export const eip6963FocusTrapDestination = () => null;
    export const getDiscoveredEip6963Providers = () => [];
    export const recordEip6963Announcement = () => false;
    export const selectEip6963Provider = () => undefined;
    export const shouldBindEip6963ProviderEvents = () => false;
    export const shouldPromptEip6963Provider = () => false;
    export const waitForWalletProvider = async () => undefined;
  `,
};

async function buildHarness(): Promise<string> {
  type Build = {
    onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void;
    onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void;
  };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{
      name: 'privy-wallet-bridge-mocks',
      setup(build: Build) {
        build.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: '@privy-io/react-auth', namespace: 'mock' }));
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
          for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
          if (existsSync(candidate)) return { path: candidate };
          return { path: candidate };
        });
        build.onResolve({ filter: /^\.\// }, (args: { path: string; resolveDir?: string }) => {
          const key = args.path;
          if (mocks[key]) return { path: key, namespace: 'mock' };
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';

async function openHarness(page: import('@playwright/test').Page): Promise<void> {
  await page.setContent(`<div id="root"></div><script>${bundle}</script>`);
  await expect(page.locator('[data-harness-ready="true"]')).toHaveCount(1);
}

async function setState(page: import('@playwright/test').Page, state: Record<string, unknown>): Promise<void> {
  await page.evaluate((next) => {
    const harness = (globalThis as typeof globalThis & { __privyHarness: Record<string, unknown> }).__privyHarness;
    if (typeof next.walletClientType === 'string') {
      next.wallets = [{
        address: typeof next.walletAddress === 'string' ? next.walletAddress : '0x00000000000000000000000000000000000000bb',
        type: 'ethereum', walletClientType: next.walletClientType, chainId: 'eip155:1',
        getEthereumProvider: async () => ({ request: async () => '0x1' }), switchChain: async () => {},
      }];
      delete next.walletClientType;
      delete next.walletAddress;
    }
    Object.assign(harness, next);
    harness.adapterRerender?.();
    harness.rerender?.();
  }, state);
  await page.waitForTimeout(50);
}

async function emit(page: import('@playwright/test').Page, event: 'loginComplete' | 'loginError' | 'walletSuccess' | 'walletError', address = '0x00000000000000000000000000000000000000aa'): Promise<void> {
  await page.evaluate(({ event: kind, address: nextAddress }) => {
    const harness = (globalThis as typeof globalThis & { __privyHarness: any }).__privyHarness;
    const wallet = { address: nextAddress, type: 'ethereum', walletClientType: 'browser', chainId: 'eip155:1', getEthereumProvider: async () => ({ request: async () => '0x1' }), switchChain: async () => {} };
    if (kind === 'loginComplete') {
      harness.authenticated = true;
      harness.wallets = [wallet];
      harness.loginCallbacks?.onComplete?.({ user: { wallet } });
    } else if (kind === 'loginError') harness.loginCallbacks?.onError?.('exited_auth_flow');
    else if (kind === 'walletSuccess') { harness.wallets = [wallet]; harness.walletCallbacks?.onSuccess?.({ wallet }); }
    else harness.walletCallbacks?.onError?.('wallet_rejected');
    harness.rerender?.();
  }, { event, address });
}

async function result(page: import('@playwright/test').Page): Promise<string> {
  return page.locator('[data-result]').getAttribute('data-result') as Promise<string>;
}

test.describe('Privy wallet bridge isolated callbacks', () => {
  test.beforeAll(async () => { bundle = await buildHarness(); });

  test('opens dashboard-driven login without a wallet-only override', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__privyHarness.loginCalls.length)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).__privyHarness.loginCalls[0])).toBeNull();
  });

  test('login cancellation rejects and releases the pending waiter', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await emit(page, 'loginError');
    await expect.poll(() => result(page)).toMatch(/^rejected:Sign-in cancelled\.$/);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__privyHarness.loginCalls.length)).toBe(2);
  });

  test('wallet login selects the chosen account rather than the first linked wallet', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.evaluate(() => {
      const h = (globalThis as any).__privyHarness;
      const wallet = (address: string, walletClientType: string) => ({
        address, walletClientType, type: 'ethereum', chainType: 'ethereum', chainId: 'eip155:1',
        getEthereumProvider: async () => ({ request: async () => '0x1' }), switchChain: async () => {},
      });
      const first = wallet('0x00000000000000000000000000000000000000aa', 'privy-v2');
      const chosen = wallet('0x00000000000000000000000000000000000000bb', 'browser');
      h.authenticated = true;
      h.wallets = [first, chosen];
      h.loginCallbacks.onComplete({ user: { wallet: first }, loginAccount: { ...chosen, type: 'wallet' } });
      h.adapterRerender?.();
      h.rerender?.();
    });
    await expect.poll(() => result(page)).toBe('resolved');
    await expect(page.locator('[data-address]')).toHaveAttribute('data-address', '0x00000000000000000000000000000000000000bb');
  });

  test('opposite wallet callback cannot settle a login waiter', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await emit(page, 'walletSuccess');
    await expect.poll(() => result(page)).toBe('pending');
    await emit(page, 'loginError');
    await expect.poll(() => result(page)).toMatch(/^rejected:/);
  });

  test('authenticated Connect another wallet still opens the wallet selector', async ({ page }) => {
    await openHarness(page);
    await setState(page, { authenticated: true, walletClientType: 'browser' });
    await page.getByRole('button', { name: 'Connect another wallet' }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__privyHarness.connectCalls)).toBe(1);
  });

  test('Telegram missing launch data falls back to the same full login modal', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, initData: '' });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__privyHarness.loginCalls.length)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).__privyHarness.loginCalls[0])).toBeNull();
  });

  test('Telegram seamless embedded auth does not open an external selector', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, authenticated: true, walletClientType: 'privy-v2', walletAddress: '0x00000000000000000000000000000000000000cc' });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => result(page)).toBe('resolved');
    expect(await page.evaluate(() => (globalThis as any).__privyHarness.connectCalls)).toBe(0);
  });

  test('Telegram embedded auth still allows an explicit external wallet request', async ({ page }) => {
    await openHarness(page);
    await setState(page, { telegram: true, authenticated: true, walletClientType: 'privy-v2' });
    await page.getByRole('button', { name: 'Connect another wallet' }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).__privyHarness.connectCalls)).toBe(1);
  });
});
