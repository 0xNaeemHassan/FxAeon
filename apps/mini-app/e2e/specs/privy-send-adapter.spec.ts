import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const entry = resolve(root, 'apps/mini-app/e2e/harness/privy-send-adapter-entry.tsx');
const src = resolve(root, 'apps/mini-app/src');

const mockModules: Record<string, string> = {
  '@privy-io/react-auth': `
    import { useState } from 'react';
    export function usePrivy() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.adapterRerender = () => redraw((n) => n + 1); return { ready: true, authenticated: h.authenticated, user: { id: h.userId } }; }
    export function useWallets() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.adapterRerender = () => redraw((n) => n + 1); return { wallets: h.wallets }; }
    export function useModalStatus() { const [, redraw] = useState(0); const h = globalThis.__privySendHarness; h.modalRerender = () => redraw((n) => n + 1); return { isOpen: h.modalOpen }; }
    export function useSendTransaction() { const h = globalThis.__privySendHarness; return { sendTransaction: async (request, options) => {
      h.requests.push({ request, options });
      if (h.sendError) throw new Error(h.sendError);
      h.modalOpen = true;
      h.modalRerender?.();
      h.rerender?.();
      return { hash: '0x' + 'a'.repeat(64) };
    } }; }
    export function useLogout() { return { logout: async () => {} }; }
    export function useLogin() { return { login: () => {} }; }
    export function useConnectWallet() { return { connectWallet: () => {} }; }
  `,
  '@/lib/telegram': `export const getInitData = () => ''; export const isTelegramLaunchContext = () => false;`,
  '@/lib/wallet/telegramReconnect': `export const useTelegramReconnect = () => () => {};`,
  '@/lib/fx/config': `export const assertLocalForkRpcUrl = (url) => url; export const configuredRpcUrls = () => ['https://eth-mainnet.g.alchemy.com/v2/harness'];`,
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
      name: 'privy-send-adapter-mocks',
      setup(build: Build) {
        build.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: '@privy-io/react-auth', namespace: 'mock' }));
        build.onResolve({ filter: /^@\// }, (args: { path: string }) => {
          if (mockModules[args.path]) return { path: args.path, namespace: 'mock' };
          const candidate = resolve(src, args.path.slice(2));
          for (const extension of ['.tsx', '.ts']) if (existsSync(`${candidate}${extension}`)) return { path: `${candidate}${extension}` };
          for (const index of ['index.tsx', 'index.ts']) if (existsSync(resolve(candidate, index))) return { path: resolve(candidate, index) };
          return { path: candidate };
        });
        build.onResolve({ filter: /^\.\// }, (args: { path: string }) => mockModules[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'mock' }, (args: { path: string }) => ({ contents: mockModules[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
const first = '0x00000000000000000000000000000000000000aa';
const second = '0x00000000000000000000000000000000000000bb';
const hash = `0x${'a'.repeat(64)}`;

async function openHarness(page: import('@playwright/test').Page, embedded = true) {
  await page.setContent('<div id="root"></div>');
  await page.evaluate((embedded) => {
    (globalThis as any).__privySendHarness = {
      authenticated: true,
      userId: 'user-a',
      wallets: [],
      requests: [],
      providerChain: '0x1',
      providerAccounts: [],
      requestFrom: undefined,
      embedded,
      providerRequests: [],
      fees: undefined,
      modalOpen: false,
      result: 'idle',
      sendError: undefined,
    };
  }, embedded);
  await page.evaluate((code) => (0, eval)(code), bundle);
  await expect(page.locator('[data-ready="true"]')).toHaveCount(1);
  await page.evaluate(({ firstAddress, secondAddress }) => {
    const h = (globalThis as any).__privySendHarness;
    const makeWallet = (address: string) => ({
      address, type: 'ethereum', walletClientType: h.embedded ? 'privy-v2' : 'metamask', chainId: 'eip155:1',
      getEthereumProvider: async () => ({ request: async (args: { method: string; params?: unknown[] }) => {
        if (args.method === 'eth_chainId') return h.providerChain;
        if (args.method === 'eth_accounts') return h.providerAccounts;
        if (args.method === 'eth_sendTransaction') { h.providerRequests.push(args); return '0x' + 'a'.repeat(64); }
        throw new Error(`Unexpected provider call: ${args.method}`);
      } }),
      switchChain: async () => {},
    });
    h.wallets = [makeWallet(firstAddress), makeWallet(secondAddress)];
    h.providerAccounts = [firstAddress];
    h.adapterRerender?.();
    h.rerender?.();
  }, { firstAddress: first, secondAddress: second });
}

async function send(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect.poll(() => page.locator('main').getAttribute('data-result')).not.toBe('pending');
}

async function closeModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Close Privy success screen' }).click();
  await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'false');
}

test.describe('real FxAeon Privy send adapter with mocked Privy hooks', () => {
  test.beforeAll(async () => { bundle = await buildHarness(); });

  test('routes a fully populated request to the selected embedded wallet and preserves each step prompt', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first.toUpperCase().replace('0X', '0x'));
    await page.getByRole('button', { name: 'Select second wallet' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-address', second);
    await page.evaluate((from) => {
      const h = (globalThis as any).__privySendHarness;
      h.requestFrom = from;
      h.providerAccounts = [from];
    }, second);

    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
    await closeModal(page);
    await send(page, 'Send action');

    const requests = await page.evaluate(() => (globalThis as any).__privySendHarness.requests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      request: {
        from: second,
        to: '0x00000000000000000000000000000000000000dd',
        data: '0x12345678', value: 7n, nonce: 8n, gasLimit: 21000n,
        gasPrice: 9n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n, chainId: 1,
      },
      options: {
        address: second,
        uiOptions: {
          showWalletUIs: true,
          description: 'Review this f(x) transaction in your wallet.',
          buttonText: 'Approve token',
          successHeader: 'Transaction submitted',
          successDescription: 'Your transaction is now being confirmed on-chain.',
          isCancellable: true,
          transactionInfo: { action: 'Token approval' },
        },
      },
    });
    expect(requests[1].options.uiOptions.showWalletUIs).toBe(true);
    expect(requests[1].options.uiOptions.buttonText).toBe('Confirm transaction');
    expect(requests[1].options.uiOptions.transactionInfo).toEqual({ action: 'Protocol action' });
    expect(await page.locator('main').getAttribute('data-result')).toBe(hash);
  });

  test('forwards the selected Standard, Fast, and Rapid fee caps on every embedded approval and action', async ({ page }) => {
    await openHarness(page);
    const tiers = [
      { gasPrice: 9n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n },
      { gasPrice: 11n, maxFeePerGas: 14n, maxPriorityFeePerGas: 3n },
      { gasPrice: 15n, maxFeePerGas: 20n, maxPriorityFeePerGas: 5n },
    ];
    for (const tier of tiers) {
      await page.evaluate((fees) => { (globalThis as any).__privySendHarness.fees = fees; }, tier);
      await send(page, 'Send approval');
      await closeModal(page);
      await send(page, 'Send action');
      await closeModal(page);
    }
    const requests = await page.evaluate(() => (globalThis as any).__privySendHarness.requests);
    expect(requests).toHaveLength(6);
    for (let index = 0; index < tiers.length; index += 1) {
      for (const request of requests.slice(index * 2, index * 2 + 2)) {
        expect(request.request).toMatchObject(tiers[index]);
        expect(request.options.uiOptions.showWalletUIs).toBe(true);
      }
    }
  });

  test('returns the approval hash immediately but waits for its open Privy screen before the action prompt', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
    await expect(page.locator('main')).toHaveAttribute('data-modal-open', 'true');

    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);

    await closeModal(page);
    await expect.poll(async () => page.evaluate(() => (globalThis as any).__privySendHarness.requests.length)).toBe(2);
    await expect(page.locator('main')).toHaveAttribute('data-result', hash);
  });

  test('aborts the queued action if the selected wallet changes while waiting for modal close', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.getByRole('button', { name: 'Select second wallet' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', /wallet or session changed/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('fails closed when an embedded send bypasses the runner preflight', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action without preflight' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', /close the Privy transaction screen and retry/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('aborts the queued action if the authenticated Privy session changes while waiting', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.evaluate(() => {
      const h = (globalThis as any).__privySendHarness;
      h.authenticated = false;
      h.userId = 'user-b';
      h.adapterRerender?.();
    });
    await expect(page.locator('main')).toHaveAttribute('data-result', /wallet or session changed/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
  });

  test('aborts the queued action on unmount while preserving the prior approval hash', async ({ page }) => {
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.evaluate(() => (globalThis as any).__privySendHarness.unmount());
    await expect.poll(async () => page.evaluate(() => (globalThis as any).__privySendHarness.result)).toMatch(/wallet session ended/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.previousResult)).toBe(hash);
  });

  test('times out with recovery guidance, then allows a fresh send after closing the screen', async ({ page }) => {
    await page.clock.install();
    await openHarness(page);
    await send(page, 'Send approval');
    await page.getByRole('button', { name: 'Send action', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('data-result', 'pending');
    await page.clock.fastForward(60_001);
    await expect(page.locator('main')).toHaveAttribute('data-result', /close the Privy transaction screen/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(1);

    await closeModal(page);
    await send(page, 'Send action');
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(2);
  });

  test('lets an external wallet price the transaction and preserves its other fields', async ({ page }) => {
    await openHarness(page, false);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first);
    await send(page, 'Send approval');
    const captured = await page.evaluate(() => (globalThis as any).__privySendHarness.providerRequests);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      method: 'eth_sendTransaction',
      params: [{
        from: first,
        to: '0x00000000000000000000000000000000000000dd',
        data: '0x12345678',
        value: '0x7',
        nonce: '0x8',
        gas: '0x5208',
      }],
    });
    expect(captured[0].params[0]).not.toHaveProperty('gasPrice');
    expect(captured[0].params[0]).not.toHaveProperty('maxFeePerGas');
    expect(captured[0].params[0]).not.toHaveProperty('maxPriorityFeePerGas');
  });

  test('refuses to prompt if the provider chain changes before signing', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((chain) => { (globalThis as any).__privySendHarness.providerChain = chain; }, '0x2105');
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /wrong network/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });

  test('refuses to prompt if the provider account changes before signing', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((account) => { (globalThis as any).__privySendHarness.providerAccounts = [account]; }, second);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, first);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /account does not match/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });

  test('rejects a request authored for an account other than the selected wallet', async ({ page }) => {
    await openHarness(page);
    await page.evaluate((from) => { (globalThis as any).__privySendHarness.requestFrom = from; }, second);
    await send(page, 'Send approval');
    await expect(page.locator('main')).toHaveAttribute('data-result', /sender does not match/i);
    expect(await page.evaluate(() => (globalThis as any).__privySendHarness.requests)).toHaveLength(0);
  });
});
