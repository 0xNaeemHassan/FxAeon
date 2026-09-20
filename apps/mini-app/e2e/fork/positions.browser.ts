/**
 * Protected real-fork browser acceptance test. All protocol transactions are
 * planned, reviewed, simulated and sent by the actual browser application.
 * Only the injected wallet transport and fork-local index discovery are test
 * adapters. Receipt delivery can be paused, but its real RPC payload is never
 * changed. No planner, transaction runner, receipt or position value is mocked.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect as playwrightExpect, type Locator, type Page, type Route } from '@playwright/test';
import { createPublicClient, encodeFunctionData, formatUnits, http, parseUnits, type Address, type Hex } from 'viem';
import { formatExactDecimal } from '../../src/lib/amount';
import { formatAmount, readPositionGroupWithDirectFallback, tokenAddress } from '../../src/app/trade/fxUi';
import { readCanonicalPositionInfo } from '../../src/app/trade/canonicalPositionReader';
import { DIRECT_POSITION_SCAN_MAX_IDS, DIRECT_POSITION_SCAN_BATCH_SIZE } from '../../src/app/trade/directPositionDiscovery';
import { planIncreasePosition } from '../../src/lib/fx/service';
import { runTransactionRoute } from '../../src/lib/fx/runner';
import { getFxReadFacade } from '../../src/lib/fx/readFacade';
import type { FxPublicClient } from '../../src/lib/fx/types';
import { positionPoolAddress } from '../../src/lib/fx/policy';
import { mainnet } from 'viem/chains';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = resolve(appRoot, '../..');
const artifactRoot = resolve(repoRoot, 'artifacts/anvil/browser');
const expect = playwrightExpect.configure({ timeout: 120_000 });
const rpcUrl = process.env.ANVIL_RPC_URL ?? '';
const parsedRpc = new URL(rpcUrl);
assert.ok(parsedRpc.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedRpc.hostname)
  && parsedRpc.pathname === '/' && Number(parsedRpc.port) >= 1024
  && !parsedRpc.username && !parsedRpc.password && !parsedRpc.search && !parsedRpc.hash, 'browser proof requires a credential-free localhost fork');
const port = Number(process.env.FX_FORK_BROWSER_PORT ?? '4325');
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'invalid browser proof port');
const baseUrl = `http://127.0.0.1:${port}`;
const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { timeout: 120_000 }) });
const scenarios = [
  { market: 'ETH', side: 'long', pool: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8', graphSubgraph: 'fx-v2-wsteth/3.0.0' },
  { market: 'ETH', side: 'short', pool: '0x25707b9e6690B52C60aE6744d711cf9C1dFC1876', graphSubgraph: 'fx-v2-wsteth-short/v0.1.0' },
  { market: 'BTC', side: 'long', pool: '0xAB709e26Fa6B0A30c119D8c55B887DeD24952473', graphSubgraph: 'fx-v2-wbtc/3.0.0' },
  { market: 'BTC', side: 'short', pool: '0xA0cC8162c523998856D59065fAa254F87D20A5b0', graphSubgraph: 'fx-v2-wbtc-short/v2.0.0' },
] as const;
const poolAbi = [
  { type: 'function', name: 'getNextPositionId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getPosition', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
] as const;
const tokenAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
const fxUsd = tokenAddress('fxUSD');
const donor = '0xc3d688b66703497daa19211eedff47f25384cdc3' as const;

function receiptHold() {
  let releasePromise: () => void = () => undefined;
  const waiting = new Promise<void>(resolveHold => { releasePromise = resolveHold; });
  return {
    waiting,
    intercepted: 0,
    released: false,
    release() {
      this.released = true;
      releasePromise();
    },
  };
}

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, `local RPC HTTP ${response.status}`);
  const body = await response.json() as { result: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function hexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

async function waitForExit(child: ChildProcess, label = 'Next build'): Promise<void> {
  await new Promise<void>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`${label} exited ${code}`)));
  });
}

function normalizeForkBlock(value: string | number): bigint {
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && value >= 0, 'Anvil metadata fork block number must be a safe integer');
    return BigInt(value);
  }
  assert.match(value, /^(?:0x[0-9a-f]+|[0-9]+)$/i, 'Anvil metadata fork block number must be hexadecimal or decimal');
  return BigInt(value);
}

async function runProof(captureStage: string) {
  await mkdir(artifactRoot, { recursive: true });
  assert.equal(await rpc('eth_chainId'), '0x1');
  assert.match(await rpc<string>('web3_clientVersion'), /anvil/i, 'never use a real RPC for this test');
  const [wallet, alternateWallet] = await rpc<Address[]>('eth_accounts');
  assert.ok(wallet && alternateWallet, 'Anvil must expose disposable accounts for session isolation checks');
  let selectedWallet: Address | null = wallet;
  const forkHead = await client.getBlockNumber();
  const metadata = await rpc<{ forkedNetwork?: { forkBlockNumber?: string | number } }>('anvil_metadata');
  const forkBaseRaw = metadata.forkedNetwork?.forkBlockNumber;
  assert.ok(forkBaseRaw !== undefined, 'Anvil metadata must expose the original fork block');
  const forkBlock = normalizeForkBlock(forkBaseRaw);
  if (process.env.ANVIL_FORK_BLOCK?.trim()) {
    assert.equal(forkBlock, BigInt(process.env.ANVIL_FORK_BLOCK.trim()), 'fork metadata does not match the requested pinned block');
  }
  assert.ok(forkHead >= forkBlock, 'Anvil head must not precede its configured fork block');
  const snapshot = await rpc<string>('evm_snapshot');
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Page | undefined;
  const miningTasks: Promise<unknown>[] = [];
  const miningErrors: string[] = [];
  const submitted: Array<{ hash: Hex; to: string; data: string; value?: string }> = [];
  const heldReceipts = new Map<string, ReturnType<typeof receiptHold>>();
  const submittedExplorerHashes = new Set<string>();
  const candidates: Array<(typeof scenarios)[number] & { positionId: number }> = [];
  const delayedDiscoveries = new Map<string, number>();
  const blockedDiscoveries = new Set<string>();
  const emittedDiscoveries = new Set<string>();
  const confirmedBeforeIndexer = new Set<string>();
  const restoredConfirmed = new Set<string>();
  const positions: Array<(typeof scenarios)[number] & {
    positionId: number; rawCollateral: string; rawDebt: string;
    transactions: Array<{ kind: string; hash: Hex; blockNumber: string }>;
  }> = [];
  const closedPositions: Array<{
    market: 'ETH' | 'BTC'; side: 'long' | 'short'; positionId: number;
    transactions: Array<{ hash: Hex; blockNumber: string }>;
  }> = [];
  let existingBorrowProof: {
    market: 'ETH'; positionId: number; requestedFxUsdWei: string;
    collateralBefore: string; collateralAfter: string; debtBefore: string; debtAfter: string;
    walletFxUsdBefore: string; walletFxUsdAfter: string;
    transactions: Array<{ hash: Hex; blockNumber: string }>;
  } | undefined;
  let externalPositionProof: {
    market: 'ETH'; side: 'long'; pool: Address; positionId: number;
    createdBy: Address; transferredTo: Address; transferredBackTo: Address; finalOwner: Address;
    rawCollateral: string; rawDebt: string; transactions: Array<{ kind: string; hash: Hex; blockNumber: string }>;
  } | undefined;
  const browserErrors: string[] = [];
  const routeErrors: string[] = [];
  let tearingDown = false;
  let reportRouteFailure: (error: Error) => void = () => undefined;
  // Resolve with the error rather than rejecting an unattached promise. The
  // main browser-proof race rethrows it inside this function's catch/finally.
  const routeFailure = new Promise<Error>(resolveFailure => { reportRouteFailure = resolveFailure; });
  const proofValue = <T>(value: T): T => {
    if (tearingDown || routeErrors.length) throw new Error(routeErrors[0] ?? 'Browser proof is stopping');
    return value;
  };
  const guardRoute = (handler: (route: Route) => Promise<void>) => async (route: Route): Promise<void> => {
    try {
      await handler(route);
    } catch (cause) {
      if (!tearingDown) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        routeErrors.push(error.message);
        reportRouteFailure(error);
      }
      await route.abort('failed').catch(() => undefined);
    }
  };
  let completed = false;
  try {
    // Anvil fetches untouched historical storage from the upstream provider
    // lazily. Preload ownership slots as fixture setup so the browser reads a
    // locally hydrated fork, like a full RPC node. No returned state is changed
    // or injected into the app, and the product's 12-second deadline is intact.
    // This is functional evidence, not a cold-provider performance benchmark.
    for (const group of scenarios) {
      const nextId = Number(await client.readContract({ address: group.pool, abi: poolAbi, functionName: 'getNextPositionId' }));
      assert.ok(nextId >= 1 && nextId - 1 <= DIRECT_POSITION_SCAN_MAX_IDS, 'fixture pool must fit the supported direct discovery range');
      for (let start = 1; start < nextId; start += DIRECT_POSITION_SCAN_BATCH_SIZE) {
        const count = Math.min(DIRECT_POSITION_SCAN_BATCH_SIZE, nextId - start);
        await client.multicall({
          contracts: Array.from({ length: count }, (_, offset) => ({
            address: group.pool,
            abi: poolAbi,
            functionName: 'ownerOf' as const,
            args: [BigInt(start + offset)] as const,
          })),
          allowFailure: true,
          batchSize: 0,
        });
      }
      console.log(`Hydrated historical NFT ownership storage for ${group.market} ${group.side}`);
    }
    const funding = parseUnits('4000', 6);
    const before = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    assert.ok(await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [donor] }) >= funding);
    await rpc('anvil_impersonateAccount', [donor]);
    try {
      await rpc('anvil_setBalance', [donor, '0x8ac7230489e80000']);
      const hash = await rpc<Hex>('eth_sendTransaction', [{ from: donor, to: usdc,
        data: encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [wallet, funding] }) }]);
      assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
    } finally { await rpc('anvil_stopImpersonatingAccount', [donor]); }
    assert.equal(await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] }) - before, funding);
    await rpc('anvil_setBalance', [wallet, '0x4563918244f40000']); // 5 fork-only ETH for gas.

    const buildEnv = { ...process.env, NEXT_PUBLIC_PRIVY_APP_ID: '', NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: '',
      NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: '', NEXT_PUBLIC_FX_SCREENSHOT_MODE: '', NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE: '1',
      NEXT_PUBLIC_FX_LOCAL_FORK_RPC_URL: rpcUrl, NEXT_PUBLIC_TELEGRAM_APP_URL: 'https://t.me/FxAeonBot' };
    console.log('Building browser acceptance artifact with localhost-only RPC');
    await waitForExit(spawn(process.execPath, [resolve(appRoot, 'node_modules/next/dist/bin/next'), 'build'],
      { cwd: appRoot, env: buildEnv, stdio: 'inherit', windowsHide: true }));
    server = spawn(process.execPath, ['e2e/serve.mjs'], { cwd: appRoot, env: { ...buildEnv, E2E_BUILD: '0', PORT: String(port) }, stdio: 'inherit', windowsHide: true });
    await expect.poll(async () => {
      if (server?.exitCode !== null) throw new Error('browser test server stopped');
      return fetch(`${baseUrl}/trade`).then(r => r.status).catch(() => 0);
    }, { timeout: 30_000 }).toBe(200);

    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
      locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    // A real EIP-1193 adapter installed only by the test. It cannot send to an
    // upstream endpoint or sign messages. A second local account is available
    // for read-only session tests; only the funded account may send a trade.
    await context.exposeBinding('__fxForkSelectWallet', async (source, address: Address | null) => {
      assert.equal(source.frame, source.page.mainFrame());
      assert.equal(new URL(source.frame.url()).origin, baseUrl);
      assert.ok(address === null || address === wallet || address === alternateWallet);
      selectedWallet = address;
    });
    await context.exposeBinding('__fxForkWallet', async (source, request: { method: string; params?: unknown[] }) => {
      assert.equal(source.frame, source.page.mainFrame(), 'fork wallet is available only to the app main frame');
      assert.equal(new URL(source.frame.url()).origin, baseUrl, 'fork wallet rejects external origins');
      if (request.method === 'eth_accounts') return selectedWallet ? [selectedWallet] : [];
      if (request.method === 'eth_requestAccounts') { selectedWallet ??= wallet; return [selectedWallet]; }
      if (request.method === 'eth_chainId') return '0x1';
      if (request.method === 'wallet_switchEthereumChain') {
        assert.equal((request.params?.[0] as { chainId: string })?.chainId, '0x1');
        return null;
      }
      assert.equal(request.method, 'eth_sendTransaction', 'unexpected wallet method');
      assert.equal(selectedWallet, wallet, 'read-only alternate session must never send');
      const tx = request.params?.[0] as { from: string; to: string; data?: string; value?: string };
      assert.equal(tx.from.toLowerCase(), wallet.toLowerCase());
      const hash = await rpc<Hex>('eth_sendTransaction', [tx]);
      heldReceipts.set(hash.toLowerCase(), receiptHold());
      submitted.push({ hash, to: tx.to, data: tx.data ?? '0x', value: tx.value });
      // Mine the runner's post-receipt boundary without continuously advancing
      // fork time while slow route simulation/quoting is in progress.
      miningTasks.push(new Promise(resolveMine => setTimeout(resolveMine, 750))
        .then(() => rpc('anvil_mine', ['0x1']))
        .catch(error => { miningErrors.push(String(error)); }));
      return hash;
    });
    // Raw browser JavaScript avoids TSX's function-name helpers leaking into
    // Playwright's serialized init script (the page does not load TSX).
    await context.addInitScript({ content: `
      const walletListeners = new Map();
      window.ethereum = {
        request(request) { return window.__fxForkWallet(request); },
        on(event, listener) {
          if (!walletListeners.has(event)) walletListeners.set(event, new Set());
          walletListeners.get(event).add(listener);
        },
        removeListener(event, listener) { walletListeners.get(event)?.delete(listener); }
      };
      window.__fxForkChangeAccount = async (address) => {
        await window.__fxForkSelectWallet(address);
        walletListeners.get('accountsChanged')?.forEach(listener => listener(address ? [address] : []));
      };
    ` });
    await context.route('**/telegram-web-app.js', guardRoute(route => route.fulfill({ contentType: 'text/javascript', body: '/* browser entry */' })));
    await context.route(rpcUrl, guardRoute(async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON() as { id: number; method: string; params?: unknown[] }
        | Array<{ id: number; method: string; params?: unknown[] }>;
      const requests = Array.isArray(body) ? body : [body];
      const held = requests.flatMap(request => {
        const hash = request.method === 'eth_getTransactionReceipt' && typeof request.params?.[0] === 'string'
          ? request.params[0].toLowerCase() : undefined;
        const hold = hash ? heldReceipts.get(hash) : undefined;
        return hash && hold && !hold.released ? [{ hash, hold, id: request.id }] : [];
      });
      if (!held.length) return route.continue();
      // Fetch the actual fork receipt first, then withhold only its delivery
      // to the browser. All receipt fields and the response body stay intact.
      const response = await route.fetch({ maxRedirects: 0, timeout: 120_000 });
      assert.ok(response.ok(), 'held receipt must come from a successful localhost RPC response');
      const payload = await response.json() as { id: number; result?: { transactionHash?: string; status?: string } | null }
        | Array<{ id: number; result?: { transactionHash?: string; status?: string } | null }>;
      const responses = Array.isArray(payload) ? payload : [payload];
      // Anvil can return null between broadcast and mining. Let the actual
      // runner poll again; never turn pending into an assertion or fake a
      // receipt. Forward the entire original response, including any batch.
      if (held.some(({ id }) => responses.find(candidate => candidate.id === id)?.result === null)) {
        await route.fulfill({ response });
        return;
      }
      for (const { hash, hold, id } of held) {
        const receipt = responses.find(candidate => candidate.id === id)?.result;
        assert.equal(receipt?.transactionHash?.toLowerCase(), hash, 'only the real submitted receipt may be delayed');
        assert.equal(receipt?.status, '0x1', 'fork transaction must have succeeded before delivery is withheld');
        hold.intercepted += 1;
      }
      await Promise.all(held.map(({ hold }) => hold.waiting));
      await route.fulfill({ response });
    }));
    await context.route('https://api.goldsky.com/**', guardRoute(async route => {
      const url = new URL(route.request().url());
      const group = scenarios.find(s => url.pathname === `/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/${s.graphSubgraph}/gn`);
      const body = route.request().postDataJSON() as { query?: string };
      const queryWallet = [wallet, alternateWallet].find(account => {
        const expectedQuery = `query MyQuery { positions(first: 1000 where: {owner: "${account.toLowerCase()}"} orderBy: blockNumber orderDirection: desc) { id } }`;
        return body.query?.replace(/\s/g, '') === expectedQuery.replace(/\s/g, '');
      });
      assert.ok(group && !url.search && !url.hash && route.request().method() === 'POST'
        && Object.keys(body).length === 1 && queryWallet, 'unexpected indexer operation');
      const ids: Array<{ id: string }> = [];
      for (const candidate of candidates.filter(c => c.pool === group.pool)) {
        try {
          const owner = await client.readContract({ address: candidate.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(candidate.positionId)] });
          if (owner.toLowerCase() === queryWallet.toLowerCase()) {
            const key = `${candidate.market}:${candidate.side}:${candidate.positionId}`;
            const reads = delayedDiscoveries.get(key) ?? 0;
            delayedDiscoveries.set(key, reads + 1);
            // Keep a real, already-owned NFT withheld from GraphQL so the UI
            // must prove canonical wallet discovery. Never fabricate an ID.
            if (!blockedDiscoveries.has(key)) {
              ids.push({ id: String(candidate.positionId) });
              emittedDiscoveries.add(key);
            }
          }
        } catch { /* Candidate has not yet minted. No fabricated position. */ }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { positions: ids } }) });
    }));
    page = await context.newPage();
    page.setDefaultTimeout(120_000);
    page.on('pageerror', error => browserErrors.push(error.message));

    const activePage = page;
    type ReviewedTransaction = {
      heading: string;
      contract: string;
      calldata: string;
    };
    const readReviewedTransactions = async (): Promise<ReviewedTransaction[]> => {
      const actionDetails = activePage.locator('section[aria-label="Review details"]');
      await expect(actionDetails).toBeVisible({ timeout: 180_000 });
      const advanced = actionDetails.locator('details').filter({ hasText: /^Advanced details/ }).first();
      await expect(advanced).toHaveCount(1);
      await expect(advanced).toBeVisible();
      const isOpen = await advanced.evaluate((element) => (element as HTMLDetailsElement).open);
      if (!isOpen) await advanced.locator('summary').click();
      const reviewed = await advanced.evaluate((root) => {
        const cards = Array.from(root.querySelectorAll('p'))
          .filter((heading) => /^(?:Action|Approve\b)/.test(heading.textContent?.trim() ?? ''))
          .map((heading) => heading.parentElement)
          .filter((card): card is HTMLElement => Boolean(card));
        return cards.map((card) => {
          const rows: Record<string, string> = {};
          for (const row of Array.from(card.querySelectorAll('div.flex.items-start'))) {
            const children = Array.from(row.children);
            const label = children[0]?.textContent?.trim();
            const value = children[1]?.textContent?.trim();
            if (label && value) rows[label] = value;
          }
          return {
            heading: card.querySelector('p')?.textContent?.trim() ?? '',
            contract: rows.Contract ?? '',
            calldata: card.querySelector('pre[aria-label="Transaction calldata"]')?.textContent?.trim() ?? '',
          };
        });
      });
      assert.ok(reviewed.length > 0 && reviewed.length <= 10, 'action details must list one to ten transactions');
      assert.ok(reviewed.some((transaction) => transaction.heading.startsWith('Action ')), 'action details must include the protocol action');
      reviewed.forEach((transaction, index) => {
        const headingNumber = transaction.heading.match(/^(?:Action|Approve\b).*\s(\d+)$/)?.[1];
        assert.equal(headingNumber, String(index + 1), `transaction ${index + 1} must have an ordered heading`);
        assert.match(transaction.contract, /^0x[0-9a-fA-F]{40}$/, `transaction ${index + 1} must show its contract`);
        assert.match(transaction.calldata, /^0x[0-9a-fA-F]*$/, `transaction ${index + 1} must show its calldata`);
      });
      return reviewed;
    };
    const driveDirectAction = async (buttonName: string, screenshotPrefix: string): Promise<{ signedBefore: number; transactionCount: number }> => {
      const actionButton = activePage.getByRole('button', { name: buttonName, exact: true });
      const signedBefore = submitted.length;
      let firstSignatureObserved = false;
      let reviewedTransactions: ReviewedTransaction[] = [];
      for (let attempt = 0; attempt < 3 && !firstSignatureObserved; attempt += 1) {
        await expect(actionButton).toBeVisible({ timeout: 180_000 });
        reviewedTransactions = await readReviewedTransactions();
        assert.equal(submitted.length, signedBefore, 'read-only action details must never request a signature');
        await actionButton.click();
        const changedNotice = activePage.locator('[role="status"]')
          .filter({ hasText: 'Details changed. Check the updated action before continuing.' }).first();
        const deadline = Date.now() + 180_000;
        let changed = false;
        while (Date.now() < deadline) {
          if (routeErrors.length) throw new Error(routeErrors[0]);
          if (submitted.length > signedBefore) {
            firstSignatureObserved = true;
            break;
          }
          if (await changedNotice.isVisible().catch(() => false)) {
            changed = true;
            break;
          }
          await activePage.waitForTimeout(250);
        }
        if (!firstSignatureObserved && !changed) throw new Error('timed out waiting for the first signature or a changed-action notice');
        if (!firstSignatureObserved && attempt === 2) throw new Error('action details changed repeatedly before the first signature');
      }
      assert.equal(firstSignatureObserved, true, 'the explicit action must submit its first transaction');

      let transactionIndex = 0;
      while (transactionIndex < reviewedTransactions.length) {
        const expected = signedBefore + transactionIndex + 1;
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && submitted.length < expected) {
          if (routeErrors.length) throw new Error(routeErrors[0]);
          if (await activePage.getByRole('button', { name: 'Done', exact: true }).isVisible().catch(() => false)) {
            throw new Error('action completed before all reviewed transactions were broadcast');
          }
          await activePage.waitForTimeout(250);
        }
        if (submitted.length < expected) throw new Error(`transaction ${transactionIndex + 1} was not broadcast before the timeout`);
        const tx = submitted[signedBefore + transactionIndex];
        const reviewedTransaction = reviewedTransactions[transactionIndex];
        assert.ok(reviewedTransaction, `broadcast ${transactionIndex + 1} has no reviewed transaction`);
        assert.equal(tx.to.toLowerCase(), reviewedTransaction.contract.toLowerCase(), `broadcast ${transactionIndex + 1} target differs from action details`);
        assert.equal(tx.data.toLowerCase(), reviewedTransaction.calldata.toLowerCase(), `broadcast ${transactionIndex + 1} calldata differs from action details`);
        const hold = heldReceipts.get(tx.hash.toLowerCase());
        assert.ok(hold, 'each actual broadcast must be held before browser receipt completion');
        await expect.poll(() => proofValue(hold.intercepted)).toBeGreaterThan(0);
        const explorer = activePage.locator('section[aria-label="Submitted transactions"]')
          .locator(`a[href="https://etherscan.io/tx/${tx.hash}"]`);
        await expect(explorer).toBeVisible();
        const kind = reviewedTransaction.heading.startsWith('Approve') ? 'Approval' : 'Action';
        await expect(explorer).toHaveAccessibleName(new RegExp(`^${kind} ${transactionIndex + 1}: Submitted\\.`));
        const bounds = await explorer.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, 'submitted explorer target must be at least 44px');
        await expect(activePage.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
        assert.equal(submitted.length, expected, 'no later step may sign before this receipt is delivered');
        submittedExplorerHashes.add(tx.hash.toLowerCase());
        await activePage.screenshot({ path: resolve(artifactRoot, `${screenshotPrefix}-submitted-${transactionIndex + 1}.png`), fullPage: true });
        hold.release();
        transactionIndex += 1;
      }
      assert.ok(transactionIndex > 0, 'the explicit action must submit at least one transaction');
      assert.equal(transactionIndex, reviewedTransactions.length, 'actual signatures must match the reviewed transaction count');
      return { signedBefore, transactionCount: reviewedTransactions.length };
    };
    const ensureInputAssetPickerOpen = async (): Promise<void> => {
      const trigger = activePage.getByRole('button', { name: 'Input asset', exact: true });
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(activePage.getByRole('dialog', { name: 'Input asset', exact: true })).toBeVisible();
    };
    const ensureFormAdvancedDetailsOpen = async (): Promise<void> => {
      const summary = activePage.locator('summary')
        .filter({ has: activePage.locator('span[aria-hidden="true"]') })
        .filter({ hasText: /^Advanced/ }).first();
      await expect(summary).toBeVisible();
      const open = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
      if (!open) await summary.click();
      await expect(summary).toBeVisible();
    };
    const assertCanonicalCard = async (group: { market: 'ETH' | 'BTC'; side: 'long' | 'short' }, positionId: number, card: Locator): Promise<void> => {
      const info = await readCanonicalPositionInfo({
        client: client as unknown as FxPublicClient,
        group,
        positionId,
      });
      await expect(card).toContainText(`${formatAmount(info.rawColls, info.rawCollsDecimals)} ${info.rawCollsToken}`);
      await expect(card).toContainText(`${formatAmount(info.rawDebts, info.rawDebtsDecimals)} ${info.rawDebtsToken}`);
      const leverage = (group.side === 'short' ? info.lsdLeverage : info.currentLeverage).toFixed(2).replace(/\.00$/, '');
      await expect(card).toContainText(`${leverage}× leverage`);
    };
    const runBrowserProof = async () => {
      const page = activePage;
    // A real connected session must never display another account's balance.
    // Exercise this without reloading, so the shared query cache stays mounted.
    await page.goto(`${baseUrl}/trade`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await ensureInputAssetPickerOpen();
    const sessionUsdcOption = page.getByRole('option', { name: /^USDC\b/i });
    const fundedUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    const alternateUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [alternateWallet] });
    assert.notEqual(fundedUsdc, alternateUsdc, 'session balances must be distinguishable');
    const availableLabel = (value: bigint) => `Available: ${formatExactDecimal(formatUnits(value, 6), 4)} USDC`;
    await expect(sessionUsdcOption).toContainText(availableLabel(fundedUsdc));
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(alternateWallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' }))
      .toContainText(`${alternateWallet.slice(0, 5)}…${alternateWallet.slice(-4)}`);
    // ProtocolPositionSession may remount account-owned UI while the outer
    // Wagmi cache remains mounted; preserve an already-open picker or open it.
    await ensureInputAssetPickerOpen();
    assert.ok(!(await sessionUsdcOption.innerText()).includes(availableLabel(fundedUsdc)),
      'the previous balance must disappear as soon as the new wallet identity is shown');
    await expect(sessionUsdcOption).toContainText(availableLabel(alternateUsdc));
    await expect(sessionUsdcOption).not.toContainText(availableLabel(fundedUsdc));
    await page.evaluate('window.__fxForkChangeAccount(null)');
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toHaveCount(0);
    await ensureInputAssetPickerOpen();
    assert.ok(!/Available: [\d,]/.test(await sessionUsdcOption.innerText()), 'disconnected picker must clear owned quantities');
    await expect(sessionUsdcOption).not.toContainText(/Available: [\d,]/);
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(wallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' }))
      .toContainText(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    await ensureInputAssetPickerOpen();
    await expect(sessionUsdcOption).toContainText(availableLabel(fundedUsdc));
    assert.equal(submitted.length, 0, 'session checks must never request a signature');
    console.log('Live balance account-switch and disconnect isolation verified');

    // Check the live-balance amount field at every release viewport before the
    // first funded action. This keeps the responsive assertion independent of
    // transaction state while exercising the real wallet balance read.
    const responsiveViewports = [
      { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 },
      { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1024, height: 768 },
      { width: 1440, height: 900 }, { width: 390, height: 500 },
    ] as const;
    for (const viewport of responsiveViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}/trade`);
      await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible({ timeout: 30_000 });
      await ensureInputAssetPickerOpen();
      const responsiveUsdc = page.getByRole('option', { name: /^USDC\b/i });
      const responsiveBalance = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await expect(responsiveUsdc).toContainText(`Available: ${formatExactDecimal(formatUnits(responsiveBalance, 6), 4)} USDC`);
      await responsiveUsdc.click();
      const responsiveAmount = page.getByLabel('Amount in USDC', { exact: true });
      const responsiveMeta = page.locator('[class*="amountBalanceMeta"]').filter({ hasText: /Available:/ }).first();
      const responsiveBalanceLabel = responsiveMeta.locator(':scope > :first-child > span').first();
      await expect(responsiveBalanceLabel).toBeVisible();
      const responsiveMetaBox = await responsiveMeta.boundingBox();
      const responsiveAmountBox = await responsiveAmount.boundingBox();
      const responsiveBalanceTextBox = await responsiveBalanceLabel.boundingBox();
      const responsiveBalanceTextMetrics = await responsiveBalanceLabel.evaluate((element) => {
        const node = element as HTMLElement;
        return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
      });
      assert.ok(responsiveMetaBox && responsiveAmountBox && responsiveMetaBox.width > 0 && responsiveAmountBox.width > 0,
        `live balance metadata must render at ${viewport.width}x${viewport.height}`);
      assert.ok(responsiveBalanceTextBox && responsiveBalanceTextBox.width > 0 && responsiveBalanceTextBox.height > 0
        && responsiveBalanceTextBox.x >= responsiveMetaBox!.x - 1
        && responsiveBalanceTextBox.x + responsiveBalanceTextBox.width <= responsiveMetaBox!.x + responsiveMetaBox!.width + 1
        && responsiveBalanceTextMetrics.scrollWidth <= responsiveBalanceTextMetrics.clientWidth + 1,
      `live Available balance must be visible without clipping at ${viewport.width}x${viewport.height}`);
      if (viewport.width <= 640) assert.ok(responsiveMetaBox!.width >= responsiveAmountBox!.width - 2,
        `live balance metadata must span the compact amount field at ${viewport.width}x${viewport.height}`);
      for (const label of ['25%', '50%', '75%', '100%']) {
        const fraction = page.locator('.fraction-button').filter({ hasText: label }).first();
        await fraction.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        await expect(fraction, `${label} must remain visible at ${viewport.width}x${viewport.height}`).toBeVisible();
        const box = await fraction.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, `${label} must retain a 44px hit target at ${viewport.width}x${viewport.height}`);
        const navigationTop = await page.evaluate(() => {
          const navigation = document.querySelector<HTMLElement>('nav.mobile-tabbar[aria-label="Primary navigation"]');
          if (!navigation || getComputedStyle(navigation).display === 'none') return null;
          return navigation.getBoundingClientRect().top;
        });
        assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1
          && (navigationTop === null || box.y + box.height <= navigationTop + 1),
        `${label} must be fully reachable at ${viewport.width}x${viewport.height}`);
        assert.ok(await fraction.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return topmost === element || Boolean(topmost && element.contains(topmost));
        }), `${label} must be hit-testable at ${viewport.width}x${viewport.height}`);
      }
      await page.locator('.fraction-button').filter({ hasText: '25%' }).first().click();
      await expect(responsiveAmount).toHaveValue(formatUnits(responsiveBalance / 4n, 6));
      console.log(`Responsive live-balance shortcuts verified at ${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scenario of scenarios) {
      console.log(`Browser preparing ${scenario.market} ${scenario.side}`);
      const positionId = Number(await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'getNextPositionId' }));
      const key = `${scenario.market}:${scenario.side}:${positionId}`;
      candidates.push({ ...scenario, positionId });
      blockedDiscoveries.add(key);
      const signedBefore: number = submitted.length;
      await page.goto(`${baseUrl}/trade`);
      await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('radiogroup', { name: 'Market', exact: true }).getByRole('radio', { name: scenario.market, exact: true }).click();
      await page.getByRole('radiogroup', { name: 'Position side' }).getByRole('radio', { name: scenario.side === 'long' ? 'Long' : 'Short', exact: true }).click();
      await ensureInputAssetPickerOpen();
      const usdcOption = page.getByRole('option', { name: /^USDC\b/i });
      const availableUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await expect(usdcOption).toContainText(`Available: ${formatExactDecimal(formatUnits(availableUsdc, 6), 4)} USDC`);
      await usdcOption.click();
      const usdcAmount = page.getByLabel('Amount in USDC', { exact: true });
      await usdcAmount.fill('1000');
      await page.getByRole('spinbutton', { name: 'Target leverage', exact: true }).fill(scenario.side === 'short' ? '0.5' : '2');
      await ensureFormAdvancedDetailsOpen();
      await page.getByLabel('Slippage tolerance percentage').fill('1');
      const actionButtonName = `Open ${scenario.market} ${scenario.side === 'long' ? 'Long' : 'Short'}`;
      const actionButton = page.getByRole('button', { name: actionButtonName, exact: true });
      await expect(actionButton).toBeVisible({ timeout: 180_000 });
      console.log(`Browser prepared ${scenario.market} ${scenario.side} action details`);
      assert.equal(submitted.length, signedBefore, 'review must never request a signature');
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-review.png`), fullPage: true });
      const { signedBefore: tradeSignedBefore, transactionCount } = await driveDirectAction(actionButtonName, `${scenario.market}-${scenario.side}`);
      assert.equal(tradeSignedBefore, signedBefore);

      // The GraphQL response is deliberately held empty for this candidate.
      // A receipt-confirmed position must still become a complete card from
      // the canonical NFT balance/ownerOf scan, without waiting for index lag.
      const positionCard = page.locator(`[data-position-key="${key}"]`).first();
      await expect(positionCard).toBeVisible({ timeout: 180_000 });
      await expect(positionCard).toContainText(`${scenario.market} ${scenario.side === 'long' ? 'Long' : 'Short'}`);
      await expect(positionCard).toContainText(`#${positionId}`);
      await expect(positionCard.getByText('Collateral', { exact: true })).toBeVisible();
      await expect(positionCard.getByText('Debt', { exact: true })).toBeVisible();
      await expect.poll(() => proofValue(delayedDiscoveries.get(key) ?? 0)).toBeGreaterThan(0);
      assert.equal(emittedDiscoveries.has(key), false, 'GraphQL index response must remain withheld during direct discovery');
      await assertCanonicalCard(scenario, positionId, positionCard);
      confirmedBeforeIndexer.add(key);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible({ timeout: 180_000 });
      await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
      const own = await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(positionId)] });
      assert.equal(own.toLowerCase(), wallet.toLowerCase());
      const [collateral, debt] = await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(positionId)] });
      assert.ok(collateral > 0n && debt > 0n);
      assert.equal(Number(await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'getNextPositionId' })), positionId + 1);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      const remainingUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await expect(page.locator('.trade-ticket')).toContainText(`Available: ${formatExactDecimal(formatUnits(remainingUsdc, 6), 4)} USDC`);
      await expect(positionCard).toBeVisible();
      const transactions = [];
      for (const tx of submitted.slice(signedBefore)) {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash });
        assert.equal(receipt.status, 'success');
        transactions.push({ kind: tx.to.toLowerCase() === usdc ? 'approval' : 'action', hash: tx.hash, blockNumber: receipt.blockNumber.toString() });
      }
      assert.ok(transactions.some(tx => tx.kind === 'action'));
      assert.equal(transactions.length, transactionCount, 'actual signatures must match the reviewed route');
      const actionHash = transactions.findLast(tx => tx.kind === 'action')?.hash;
      assert.ok(actionHash);
      // driveDirectAction already bound every submitted hash to its reviewed
      // contract/calldata and explorer URL before releasing its receipt.
      assert.ok(submittedExplorerHashes.has(actionHash.toLowerCase()), 'the reviewed action hash must be visible before confirmation');
      positions.push({ ...scenario, positionId, rawCollateral: collateral.toString(), rawDebt: debt.toString(), transactions });
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-confirmed-index-lag.png`), fullPage: true });

      await page.reload();
      await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('radiogroup', { name: 'Market', exact: true }).getByRole('radio', { name: scenario.market, exact: true }).click();
      await page.getByRole('radiogroup', { name: 'Position side' }).getByRole('radio', { name: scenario.side === 'long' ? 'Long' : 'Short', exact: true }).click();
      const reloadedCard = page.locator(`[data-position-key="${key}"]`).first();
      await expect(reloadedCard).toBeVisible({ timeout: 180_000 });
      await expect(reloadedCard).toContainText(`${scenario.market} ${scenario.side === 'long' ? 'Long' : 'Short'}`);
      await expect(reloadedCard).toContainText(`#${positionId}`);
      await expect.poll(() => proofValue(delayedDiscoveries.get(key) ?? 0)).toBeGreaterThanOrEqual(2);
      assert.equal(emittedDiscoveries.has(key), false, 'reload must recover from canonical wallet discovery while GraphQL remains withheld');
      await assertCanonicalCard(scenario, positionId, reloadedCard);
      restoredConfirmed.add(key);
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-restored-from-wallet.png`), fullPage: true });
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-confirmed.png`), fullPage: true });
      console.log(`Browser opened and rendered ${scenario.market} ${scenario.side} #${positionId}`);
    }

    // Create one additional position through the pinned SDK from this proof
    // process, outside the browser and therefore outside FxAeon's journal.
    // It is created by the connected Anvil account without a browser write,
    // then transferred into and back out of the alternate account to prove canonical ownership and
    // account isolation while the GraphQL response remains empty.
    const externalScenario = scenarios[0];
    const externalPool = positionPoolAddress(externalScenario.market, externalScenario.side);
    const externalFunding = parseUnits('1000', 6);
    const externalUsdcBefore = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    await rpc('anvil_impersonateAccount', [donor]);
    try {
      await rpc('anvil_setBalance', [donor, '0x8ac7230489e80000']);
      const fundingHash = await rpc<Hex>('eth_sendTransaction', [{ from: donor, to: usdc,
        data: encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [wallet, externalFunding] }) }]);
      assert.equal((await client.waitForTransactionReceipt({ hash: fundingHash })).status, 'success');
    } finally { await rpc('anvil_stopImpersonatingAccount', [donor]); }
    assert.equal(await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] }) - externalUsdcBefore, externalFunding);
    const externalPositionId = Number(await client.readContract({ address: externalPool, abi: poolAbi, functionName: 'getNextPositionId' }));
    const externalRoutes = await planIncreasePosition({
      market: externalScenario.market,
      type: externalScenario.side,
      positionId: 0,
      leverage: 2,
      inputTokenAddress: tokenAddress('USDC'),
      amount: externalFunding,
      slippage: 1,
      userAddress: wallet,
    });
    assert.equal(externalRoutes.length, 1, 'external SDK proof must produce one reviewed route');
    const externalResult = await runTransactionRoute({
      route: externalRoutes[0],
      publicClient: client as unknown as FxPublicClient,
      callbacks: {
        requestSignature: (request) => rpc<Hex>('eth_sendTransaction', [{
          from: request.from, to: request.to, data: request.data,
          value: hexQuantity(request.value), nonce: hexQuantity(BigInt(request.nonce)),
        }]),
      },
      options: { receiptTimeoutMs: 120_000, pollMs: 100, waitForNextBlock: false },
    });
    assert.equal(externalResult.status, 'confirmed', `external SDK position route did not confirm: ${externalResult.error ?? 'unknown error'}`);
    assert.ok(externalResult.steps.every((step) => step.status === 'confirmed' && step.receipt?.status === 'success'), 'external SDK route receipts must succeed');
    const [externalCollateral, externalDebt] = await client.readContract({ address: externalPool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(externalPositionId)] });
    assert.ok(externalCollateral > 0n && externalDebt > 0n, 'external SDK position must have canonical nonzero accounting');
    assert.equal((await client.readContract({ address: externalPool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(externalPositionId)] })).toLowerCase(), wallet.toLowerCase());
    const externalKey = `${externalScenario.market}:${externalScenario.side}:${externalPositionId}`;
    candidates.push({ ...externalScenario, positionId: externalPositionId });
    blockedDiscoveries.add(externalKey);
    const transferPosition = async (from: Address, to: Address): Promise<Hex> => {
      const hash = await rpc<Hex>('eth_sendTransaction', [{ from, to: externalPool,
        data: encodeFunctionData({ abi: poolAbi, functionName: 'transferFrom', args: [from, to, BigInt(externalPositionId)] }) }]);
      assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
      return hash;
    };
    const externalTransactions = externalResult.steps.flatMap((step) => step.hash && step.receipt ? [{ kind: step.transaction.kind, hash: step.hash, blockNumber: step.receipt.blockNumber.toString() }] : []);
    assert.ok(externalTransactions.length > 0, 'external SDK position must retain receipt evidence');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible({ timeout: 30_000 });
    await page.goto(`${baseUrl}/positions`);
    const externalCard = page.locator(`[data-position-key="${externalKey}"]`).first();
    await expect(externalCard).toBeVisible({ timeout: 180_000 });
    await expect.poll(() => proofValue(delayedDiscoveries.get(externalKey) ?? 0)).toBeGreaterThan(0);
    assert.equal(emittedDiscoveries.has(externalKey), false, 'external position must remain absent from the GraphQL index response');
    const externalJournalRecord = await page.evaluate(({ walletAddress, positionId }) => {
      const raw = window.localStorage.getItem(`fxaeon:confirmed-positions:v1:${walletAddress.toLowerCase()}`);
      if (!raw) return null;
      try { return (JSON.parse(raw) as Array<{ hint?: { positionId?: number } }>).find((item) => item.hint?.positionId === positionId) ?? null; } catch { return null; }
    }, { walletAddress: wallet, positionId: externalPositionId });
    assert.equal(externalJournalRecord, null, 'externally-created position must not depend on an FxAeon journal hint');
    await assertCanonicalCard(externalScenario, externalPositionId, externalCard);
    externalPositionProof = {
      market: 'ETH', side: 'long', pool: externalPool, positionId: externalPositionId,
      createdBy: wallet, transferredTo: alternateWallet, transferredBackTo: wallet, finalOwner: alternateWallet,
      rawCollateral: externalCollateral.toString(), rawDebt: externalDebt.toString(), transactions: externalTransactions,
    };
    const assertVisiblePositionSet = async (expectedKeys: string[]) => {
      // An empty initial render is not evidence that a transferred NFT was
      // removed. Wait for the complete expected wallet inventory to hydrate.
      await expect.poll(() => page.locator('[data-position-key]').evaluateAll(cards =>
        [...new Set(cards.map(card => card.getAttribute('data-position-key')))].sort()),
      { timeout: 180_000 }).toEqual([...expectedKeys].sort());
    };
    const originalWalletKeys = positions.map(position => `${position.market}:${position.side}:${position.positionId}`);
    await transferPosition(wallet, alternateWallet);
    await page.reload();
    await assertVisiblePositionSet(originalWalletKeys);
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(alternateWallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toContainText(`${alternateWallet.slice(0, 5)}…${alternateWallet.slice(-4)}`);
    await page.goto(`${baseUrl}/positions`);
    await assertVisiblePositionSet([externalKey]);
    await transferPosition(alternateWallet, wallet);
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(wallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toContainText(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    await page.goto(`${baseUrl}/positions`);
    await assertVisiblePositionSet([...originalWalletKeys, externalKey]);
    await transferPosition(wallet, alternateWallet);
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(wallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toContainText(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    await page.goto(`${baseUrl}/positions`);
    await assertVisiblePositionSet(originalWalletKeys);
    console.log(`External SDK position #${externalPositionId} discovered canonically, then isolated across ownership transfers`);

    // Release only the four browser-created IDs after the direct-wallet proof,
    // then compare the public SDK's hydrated output with the canonical adapter
    // on this same fork. The temporary fetch boundary supplies the released
    // index rows; all accounting, quotes, ownership and leverage reads remain
    // real SDK/RPC calls.
    for (const position of positions) blockedDiscoveries.delete(`${position.market}:${position.side}:${position.positionId}`);
    await page.goto(`${baseUrl}/positions`);
    for (const position of positions) {
      const key = `${position.market}:${position.side}:${position.positionId}`;
      await expect.poll(() => proofValue(emittedDiscoveries.has(key))).toBe(true);
    }
    const sdkRead = getFxReadFacade();
    const originalFetch = globalThis.fetch;
    const releasedSdkFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://api.goldsky.com/')) {
        const path = new URL(url).pathname;
        const group = scenarios.find((candidate) => path === `/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/${candidate.graphSubgraph}/gn`);
        const groupPositions = group ? positions.filter((position) => position.pool === group.pool) : [];
        return new Response(JSON.stringify({ data: { positions: groupPositions.map((position) => ({ id: String(position.positionId) })) } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
    globalThis.fetch = releasedSdkFetch;
    try {
      for (const position of positions) {
        const canonical = await readCanonicalPositionInfo({
          client: client as unknown as FxPublicClient,
          group: position,
          positionId: position.positionId,
        });
        const sdkPositions = await sdkRead.getPositions({
          userAddress: wallet,
          market: position.market,
          type: position.side,
        });
        const sdkPosition = sdkPositions.find((candidate) => candidate.positionId === position.positionId);
        assert.ok(sdkPosition, `public SDK must return released ${position.market} ${position.side} #${position.positionId}`);
        assert.equal(sdkPosition.rawColls, canonical.rawColls, 'public SDK collateral must match canonical adapter');
        assert.equal(sdkPosition.rawDebts, canonical.rawDebts, 'public SDK debt must match canonical adapter');
        assert.equal(sdkPosition.rawCollsToken, canonical.rawCollsToken, 'public SDK collateral token must match canonical adapter');
        assert.equal(sdkPosition.rawDebtsToken, canonical.rawDebtsToken, 'public SDK debt token must match canonical adapter');
        assert.equal(sdkPosition.rawCollsDecimals, 18, 'public SDK collateral precision must remain 18');
        assert.equal(sdkPosition.rawDebtsDecimals, 18, 'public SDK debt precision must remain 18');
        assert.equal(canonical.rawCollsDecimals, 18, 'canonical collateral precision must remain 18');
        assert.equal(canonical.rawDebtsDecimals, 18, 'canonical debt precision must remain 18');
        const parityLabel = `${position.market} ${position.side} #${position.positionId}`;
        assert.ok(Math.abs(sdkPosition.currentLeverage - canonical.currentLeverage) <= 1e-10, `${parityLabel}: SDK leverage ${sdkPosition.currentLeverage} must match canonical ${canonical.currentLeverage}`);
        assert.ok(Math.abs(sdkPosition.lsdLeverage - canonical.lsdLeverage) <= 1e-10, `${parityLabel}: SDK LSD leverage ${sdkPosition.lsdLeverage} must match canonical ${canonical.lsdLeverage}`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    await page.goto(`${baseUrl}/positions`);
    for (const position of positions) {
      await expect(page.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`).first()).toBeVisible();
      await expect(page.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`).first()).toContainText('Position value');
      assert.equal((await client.readContract({ address: position.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(position.positionId)] })).toLowerCase(), wallet.toLowerCase());
      const [collateral, debt] = await client.readContract({ address: position.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(position.positionId)] });
      assert.ok(collateral > 0n && debt > 0n, 'all positions must coexist after the fourth trade');
    }
    // Keep the real four-position portfolio usable at the same release
    // viewports as the funded amount-field checks above. Each card is measured
    // after scrolling it into view independently; the portfolio is allowed to
    // extend vertically on short screens.
    for (const viewport of responsiveViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}/positions`);
      const positionCards = page.locator('[data-position-key]');
      await expect(positionCards).toHaveCount(scenarios.length, { timeout: 180_000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `positions document must not overflow horizontally at ${viewport.width}x${viewport.height}`);
      for (const position of positions) {
        const key = `${position.market}:${position.side}:${position.positionId}`;
        const card = page.locator(`[data-position-key="${key}"]`).first();
        await expect(card).toBeVisible();
        await expect(card.getByText('Position value', { exact: true })).toBeVisible();
        await expect(card.getByText('Market price', { exact: true })).toBeVisible();
        await expect(card.getByText('Debt / collateral', { exact: true })).toBeVisible();
        await expect(card.locator('xpath=..').getByRole('button', { name: 'Leverage', exact: true })).toBeVisible();
        await card.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        const cardBox = await card.boundingBox();
        const cardMetrics = await card.evaluate((element) => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight,
            left: rect.left, right: rect.right };
        });
        assert.ok(cardBox && cardBox.width > 0 && cardBox.height >= 80 && cardMetrics.clientHeight >= 80,
          `${key} card must not collapse at ${viewport.width}x${viewport.height}`);
        assert.ok(cardMetrics.scrollWidth <= cardMetrics.clientWidth + 1,
          `${key} card must not overflow horizontally at ${viewport.width}x${viewport.height}`);
        assert.ok(cardMetrics.left >= -1 && cardMetrics.right <= viewport.width + 1,
          `${key} card must fit the viewport at ${viewport.width}x${viewport.height}`);
      }
      console.log(`Responsive four-position cards verified at ${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/positions`);
    const leveragePosition = positions[0];
    assert.ok(leveragePosition, 'browser proof requires a position for the direct leverage check');
    const leverageKey = `${leveragePosition.market}:${leveragePosition.side}:${leveragePosition.positionId}`;
    const leverageCard = page.locator(`[data-position-key="${leverageKey}"]`).first();
    await expect(leverageCard).toBeVisible();
    const leverageLabel = leverageCard.getByText(/(?:LSD )?leverage/i).first();
    await expect(leverageLabel).toBeVisible();
    const leverageMetricText = await leverageLabel.evaluate((element) => {
      let current: HTMLElement | null = element as HTMLElement;
      for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
        if (/\d/.test(current.textContent ?? '')) return current.textContent ?? '';
      }
      return element.textContent ?? '';
    });
    const leverageDisplay = leverageMetricText.match(/([0-9]+(?:\.[0-9]+)?)\s*×/);
    assert.ok(leverageDisplay, `${leverageKey} card must expose its displayed leverage beside the leverage label`);
    await expect(leverageCard.locator('xpath=..').getByRole('button', { name: 'Leverage', exact: true })).toHaveCount(1);
    await leverageCard.locator('xpath=..').getByRole('button', { name: 'Leverage', exact: true }).click();
    const positionAction = page.getByRole('radiogroup', { name: 'Position action', exact: true });
    await expect(positionAction).toBeVisible();
    await expect(positionAction.getByRole('radio', { name: 'Leverage', exact: true })).toHaveAttribute('aria-checked', 'true');
    const targetLeverage = page.getByRole('spinbutton', { name: 'Target leverage', exact: true });
    await expect(targetLeverage).toBeVisible();
    expect(Number(await targetLeverage.inputValue()), "target leverage must match the card's displayed leverage").toBeCloseTo(Number(leverageDisplay![1]), 2);
    await page.goto(`${baseUrl}/positions`);
    const borrowTarget = positions.find((position) => position.market === 'ETH' && position.side === 'long');
    assert.ok(borrowTarget, 'browser proof requires an ETH long borrow target');
    const borrowTargetKey = `${borrowTarget.market}:${borrowTarget.side}:${borrowTarget.positionId}`;
    await page.locator(`[data-position-key="${borrowTargetKey}"]`).first().click();
    const borrowCta = page.getByRole('link', { name: 'Borrow against', exact: true });
    await expect(borrowCta).toHaveAttribute('href', `/borrow?market=ETH&position=${borrowTarget.positionId}`);
    await borrowCta.click();
    await expect(page).toHaveURL(new RegExp(`/borrow\\?market=ETH&position=${borrowTarget.positionId}$`));
    const linkedPosition = page.getByRole('combobox', { name: 'Collateral position', exact: true });
    await expect(linkedPosition).toHaveValue(borrowTargetKey);
    await expect(linkedPosition.locator('option:checked')).toContainText(`Trade position #${borrowTarget.positionId}`);
    await expect(page.getByRole('heading', { name: `Borrow against position #${borrowTarget.positionId}`, exact: true })).toBeVisible();

    // Exercise the CTA's real borrowing path, not just its navigation and
    // selection state. A native collateral top-up avoids an ERC-20 approval,
    // while the positive fxUSD amount proves debt and wallet issuance.
    const borrowSignedBefore = submitted.length;
    const borrowNextIdBefore = Number(await client.readContract({ address: borrowTarget.pool, abi: poolAbi, functionName: 'getNextPositionId' }));
    const [borrowCollateralBefore, borrowDebtBefore] = await client.readContract({ address: borrowTarget.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(borrowTarget.positionId)] });
    const walletFxUsdBefore = await client.readContract({ address: fxUsd, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    const requestedFxUsd = parseUnits('1', 18);
    await page.getByLabel('Collateral to add in ETH', { exact: true }).fill('0.001');
    await page.getByLabel('Additional fxUSD to borrow in fxUSD', { exact: true }).fill('1');
    const borrowActionName = 'Update collateral position';
    await expect(page.getByRole('button', { name: borrowActionName, exact: true })).toBeVisible({ timeout: 180_000 });
    assert.equal(submitted.length, borrowSignedBefore, 'borrow details must not request a signature');
    const { signedBefore: borrowSignedBeforeActual, transactionCount: borrowTransactionCount } = await driveDirectAction(borrowActionName, 'ETH-long-borrow');
    assert.equal(borrowSignedBeforeActual, borrowSignedBefore);
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible({ timeout: 180_000 });
    const [borrowCollateralAfter, borrowDebtAfter] = await client.readContract({ address: borrowTarget.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(borrowTarget.positionId)] });
    const walletFxUsdAfter = await client.readContract({ address: fxUsd, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    assert.ok(borrowCollateralAfter > borrowCollateralBefore, 'browser borrow did not add collateral to the existing position');
    assert.ok(borrowDebtAfter > borrowDebtBefore, 'browser borrow did not increase the existing position debt');
    assert.ok(walletFxUsdAfter > walletFxUsdBefore, 'browser borrow did not deliver fxUSD to the wallet');
    assert.equal(Number(await client.readContract({ address: borrowTarget.pool, abi: poolAbi, functionName: 'getNextPositionId' })), borrowNextIdBefore, 'browser borrow created a new position instead of reusing the selected ID');
    const borrowTransactions = [];
    for (const tx of submitted.slice(borrowSignedBefore)) {
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      assert.equal(receipt.status, 'success');
      borrowTransactions.push({ hash: tx.hash, blockNumber: receipt.blockNumber.toString() });
    }
    assert.equal(borrowTransactions.length, borrowTransactionCount, 'actual borrow signatures must match the reviewed route');
    existingBorrowProof = {
      market: 'ETH', positionId: borrowTarget.positionId, requestedFxUsdWei: requestedFxUsd.toString(),
      collateralBefore: borrowCollateralBefore.toString(), collateralAfter: borrowCollateralAfter.toString(),
      debtBefore: borrowDebtBefore.toString(), debtAfter: borrowDebtAfter.toString(),
      walletFxUsdBefore: walletFxUsdBefore.toString(), walletFxUsdAfter: walletFxUsdAfter.toString(),
      transactions: borrowTransactions,
    };
    borrowTarget.rawCollateral = borrowCollateralAfter.toString();
    borrowTarget.rawDebt = borrowDebtAfter.toString();
    await page.screenshot({ path: resolve(artifactRoot, 'ETH-long-borrow-confirmed.png'), fullPage: true });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.goto(`${baseUrl}/positions`);
    await page.screenshot({ path: resolve(artifactRoot, 'positions-mobile.png'), fullPage: true });
    for (const route of ['portfolio', 'earn', 'move']) {
      await page.goto(`${baseUrl}/${route}`);
      if (route === 'portfolio') {
        await expect(page.locator('.portfolio-value-metrics span').filter({ has: page.locator('small', { hasText: /^Open positions$/ }) }).locator('strong')).toHaveText('4');
        for (const position of positions.filter(p => p.market === 'ETH')) {
          await expect(page.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`)).toBeVisible();
        }
      }
      await page.getByRole('button', { name: 'Open wallet profile' }).click();
      const drawer = page.getByRole('dialog', { name: `Wallet ${wallet}`, exact: true });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-position-key]')).toHaveCount(2);
      for (const position of positions.filter(p => p.market === 'ETH')) {
        await expect(drawer.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`)).toBeVisible();
      }
      await expect(drawer).not.toContainText(/Last verified|Live verification failed|Live position verification is unavailable/);
      for (const card of await drawer.locator('[data-position-key]').all()) {
        const key = await card.getAttribute('data-position-key');
        assert.ok(positions.some(p => `${p.market}:${p.side}:${p.positionId}` === key), 'drawer must contain a real fork position');
      }
      await page.screenshot({ path: resolve(artifactRoot, `${route}-wallet-mobile.png`), fullPage: false });
      await page.getByRole('button', { name: 'Close wallet profile' }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} overflows mobile viewport`);
    }
    assert.deepEqual(browserErrors, [], 'browser must not emit runtime errors');
    assert.ok(positions.every(p => (delayedDiscoveries.get(`${p.market}:${p.side}:${p.positionId}`) ?? 0) >= 3), 'every minted position must render after delayed discovery');
    assert.equal(submittedExplorerHashes.size, submitted.length, 'every approval and action hash must be visible before receipt delivery');
    assert.equal(confirmedBeforeIndexer.size, scenarios.length, 'all four confirmed positions need direct wallet discovery while the index is withheld');
    assert.equal(restoredConfirmed.size, scenarios.length, 'all four positions must recover from canonical wallet discovery after reload');
    assert.ok(externalPositionProof, 'external SDK position proof must complete before browser closes');
    await Promise.all(miningTasks);
    assert.deepEqual(miningErrors, [], 'fork post-receipt block mining must succeed');
    // Reuse the positions this browser actually opened. The capture process
    // receives only a read-only wallet shim, never the signing transport.
    const fixturePath = resolve(captureStage, 'fixture.json');
    await writeFile(fixturePath, JSON.stringify({ schemaVersion: 1, proof: 'fxaeon-position-screenshot-fixture',
      chainId: 1, forkBlock: Number(forkBlock), wallet, executionSurface: 'browser', positions }));
    await waitForExit(spawn(process.execPath, [resolve(repoRoot, 'scripts/capture_docs_screenshots.mjs')], {
      cwd: repoRoot, windowsHide: true, stdio: 'inherit', env: { ...buildEnv,
        FX_SCREENSHOT_BASE_URL: baseUrl, FX_SCREENSHOT_POSITION_MANIFEST: fixturePath,
        // Marketing captures need stable display charts, not third-party uptime.
        // The capture adds a visible fixture label; positions and transactions
        // still come from the real isolated fork exercised above and below.
        FX_SCREENSHOT_CAPTURE_PROFILE: 'positions', FX_SCREENSHOT_MARKET_DATA: 'fixture',
        FX_SCREENSHOT_OUTPUT_DIR: captureStage, FX_SCREENSHOT_CAPTURE_REPORT: resolve(captureStage, 'capture-report.json'),
      },
    }), 'documentation capture');

    // Exercise the complete close lifecycle through the same browser UI for
    // every supported market and side. This is intentionally after the docs
    // capture so the proof includes both the four-position portfolio and the
    // honestly empty state produced by four real full closes.
    for (const position of positions) {
      const key = `${position.market}:${position.side}:${position.positionId}`;
      const signedBefore: number = submitted.length;
      const usdcBeforeClose = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await page.goto(`${baseUrl}/positions`);
      await expect(page.locator(`[data-position-key="${key}"]`).first()).toBeVisible();
      const quickActions = page.getByLabel(`Actions for ${position.market} ${position.side} position ${position.positionId}`, { exact: true });
      await quickActions.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('radiogroup', { name: 'Position action', exact: true }).getByRole('radio', { name: 'Close', exact: true })).toBeChecked();
      await expect(page.getByRole('heading', { name: 'Close the full position', exact: true })).toBeVisible();
      await expect(page.getByText('All remaining collateral and debt', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Receive asset', exact: true }).click();
      const closeUsdcOption = page.getByRole('option', { name: /^USDC\b/i });
      await expect(closeUsdcOption).toContainText(availableLabel(usdcBeforeClose));
      await closeUsdcOption.click();
      await ensureFormAdvancedDetailsOpen();
      await page.getByLabel('Slippage tolerance percentage').fill('1');
      const closeActionName = `Close ${position.market} ${position.side} position`;
      await expect(page.getByRole('button', { name: closeActionName, exact: true })).toBeVisible({ timeout: 180_000 });
      assert.equal(submitted.length, signedBefore, 'close details must never request a signature');
      await page.screenshot({ path: resolve(artifactRoot, `${position.market}-${position.side}-close-review.png`), fullPage: true });
      const { signedBefore: closeSignedBefore, transactionCount: closeTransactionCount } = await driveDirectAction(closeActionName, `${position.market}-${position.side}-close`);
      assert.equal(closeSignedBefore, signedBefore);
      const confirmedHeading = page.getByRole('heading', { name: 'Confirmed', exact: true });
      const closedPositionRow = page.locator(`[data-position-key="${key}"]`);
      // The final position can remove the manager (and therefore its success
      // sheet) as soon as the authoritative empty-position read lands. Accept
      // either presentation, while the receipt and zero-accounting assertions
      // below remain mandatory in both cases.
      await expect.poll(async () => (
        (await confirmedHeading.isVisible().catch(() => false)) || await closedPositionRow.count() === 0
      ), { timeout: 180_000 }).toBe(true);
      if (await confirmedHeading.isVisible().catch(() => false)) {
        await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      }
      await expect(closedPositionRow).toHaveCount(0);
      const [remainingCollateral, remainingDebt] = await client.readContract({ address: position.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(position.positionId)] });
      assert.equal(remainingCollateral, 0n, 'full close must clear collateral accounting');
      assert.equal(remainingDebt, 0n, 'full close must clear debt accounting');
      const usdcAfterClose = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      assert.ok(usdcAfterClose > usdcBeforeClose, 'the selected close output must return USDC to the wallet');
      const closeTransactions = [];
      for (const tx of submitted.slice(signedBefore)) {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash });
        assert.equal(receipt.status, 'success');
        closeTransactions.push({ hash: tx.hash, blockNumber: receipt.blockNumber.toString() });
      }
      assert.equal(closeTransactions.length, closeTransactionCount, 'actual close signatures must match the reviewed route');
      closedPositions.push({ market: position.market, side: position.side, positionId: position.positionId, transactions: closeTransactions });
      await page.screenshot({ path: resolve(artifactRoot, `${position.market}-${position.side}-closed.png`), fullPage: true });
      console.log(`Browser closed and removed ${position.market} ${position.side} #${position.positionId}`);
    }
    assert.equal(closedPositions.length, scenarios.length, 'every supported position must close through the browser');
    // A delayed/unavailable indexer is allowed to leave the product in its
    // honest partial-empty state. Every position has already passed the
    // receipt-bound canonical zero assertion above, so accepting that state
    // here does not turn partial reads into a claim of an exhaustive empty
    // portfolio. Prefer the normal ready-empty presentation when it arrives.
    const readyEmpty = page.getByText('No open positions', { exact: true });
    const partialEmpty = page.getByText(/Some position groups are unavailable|Position data is unavailable|Positions are temporarily unavailable/).first();
    await expect.poll(async () => {
      if (await readyEmpty.isVisible().catch(() => false)) return 'ready-empty';
      if (await partialEmpty.isVisible().catch(() => false)) return 'partial-empty';
      return 'waiting';
    }, { timeout: 120_000 }).toMatch(/^(ready-empty|partial-empty)$/);
    await page.screenshot({ path: resolve(artifactRoot, 'positions-all-closed.png'), fullPage: true });
    assert.ok(existingBorrowProof, 'existing-position borrow must complete through the browser');
    completed = true;
    await context.tracing.stop({ path: resolve(artifactRoot, 'trace.zip') });
    };
    await Promise.race([
      runBrowserProof(),
      routeFailure.then(error => { throw error; }),
    ]);
  } catch (error) {
    // Capture the actual failed snapshot before teardown reverts it. These
    // read-only diagnostics cannot make the acceptance assertions pass.
    const discoveryDiagnostics = [];
    for (const candidate of candidates) {
      const startedAt = Date.now();
      try {
        const state = await client.readContract({ address: candidate.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(candidate.positionId)] });
        const owner = await client.readContract({ address: candidate.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(candidate.positionId)] });
        try {
          const discovered = await readPositionGroupWithDirectFallback({
            client: client as unknown as FxPublicClient,
            group: candidate,
            walletAddress: wallet,
            sdk: { getPositions: async () => [] },
          });
          discoveryDiagnostics.push({ market: candidate.market, side: candidate.side, positionId: candidate.positionId, ownerMatches: owner.toLowerCase() === wallet.toLowerCase(), state: state.map(String), discoveredIds: discovered.map((position) => position.positionId), elapsedMs: Date.now() - startedAt });
        } catch (reason) {
          discoveryDiagnostics.push({ market: candidate.market, side: candidate.side, positionId: candidate.positionId, ownerMatches: owner.toLowerCase() === wallet.toLowerCase(), state: state.map(String), error: String(reason), elapsedMs: Date.now() - startedAt });
        }
      } catch (reason) {
        discoveryDiagnostics.push({ market: candidate.market, side: candidate.side, positionId: candidate.positionId, error: String(reason), elapsedMs: Date.now() - startedAt });
      }
    }
    await writeFile(resolve(artifactRoot, 'failure-discovery.json'), JSON.stringify(discoveryDiagnostics, null, 2));
    if (page) {
      await page.screenshot({ path: resolve(artifactRoot, 'failure.png'), fullPage: true }).catch(() => undefined);
      await writeFile(resolve(artifactRoot, 'failure.txt'), `${String(error)}\nBrowser errors: ${JSON.stringify(browserErrors)}\nRoute errors: ${JSON.stringify(routeErrors)}\n${await page.locator('body').innerText().catch(() => '')}`);
    }
    throw error;
  } finally {
    tearingDown = true;
    for (const hold of heldReceipts.values()) hold.release();
    await Promise.allSettled(miningTasks);
    try {
      await browser?.close();
    } finally {
      server?.kill();
      assert.equal(await rpc('evm_revert', [snapshot]), true, 'browser proof snapshot must revert');
    }
  }
  assert.ok(completed);
  assert.ok(captureStage);
  const captureReport = JSON.parse(await readFile(resolve(captureStage, 'capture-report.json'), 'utf8'));
  const expectedAssets = ['fxaeon-portfolio-positions.png', 'fxaeon-positions.png', 'fxaeon-trade-connected.png', 'fxaeon-positions-mobile.png'];
  assert.equal(captureReport.captures.length, expectedAssets.length);
  const docsArtifactRoot = resolve(artifactRoot, 'docs');
  await mkdir(docsArtifactRoot, { recursive: true });
  for (const file of expectedAssets) {
    assert.ok(captureReport.captures.some((capture: { file: string }) => capture.file === file));
    await copyFile(resolve(captureStage, file), resolve(docsArtifactRoot, file));
  }
  await writeFile(resolve(docsArtifactRoot, 'capture-report.json'), JSON.stringify(captureReport, null, 2));
  const manifestPath = process.env.FX_ANVIL_MANIFEST_PATH;
  assert.ok(manifestPath, 'parent must provide evidence path');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, proof: 'fxaeon-real-fx-position-fork', chainId: 1,
    forkBlock: forkBlock.toString(), assertions: { scenarioCount: 4, browserDriven: true,
      coexistingInSingleSnapshot: true, ownershipVerified: true, nonzeroCollateralAndDebtVerified: true,
      delayedIndexDiscoveryVerified: true, directWalletDiscoveryWithIndexerLagVerified: true,
      externalPositionWithoutJournalVerified: true, ownershipTransferIsolationVerified: true,
      canonicalPositionParityVerified: true, snapshotRevertedAfterProof: true,
      forkOwnerStoragePreloaded: true,
      availableTokenBalancesVerified: true, postConfirmationBalanceRefreshVerified: true,
      walletAccountSwitchIsolationVerified: true, disconnectedBalanceClearVerified: true,
      submittedExplorerBeforeConfirmation: true, confirmedPositionBeforeIndexer: true, restoredConfirmedPosition: true,
      positionUsdLabelsVerified: true, directCloseActionVerified: true,
      existingLongBorrowDeepLinkVerified: true, existingLongBorrowExecuted: true,
      borrowedFxUsdReceived: true, existingLongPositionIdPreserved: true,
      instantReviewVerified: true,
      everySupportedPositionClosed: true, closeOutputBalanceRefreshVerified: true,
      readSurfaces: ['trade', 'positions', 'portfolio', 'earn', 'move'] }, positions, externalPosition: externalPositionProof, existingBorrow: existingBorrowProof, closedPositions }, null, 2));
  console.log('Real browser four-position open-and-close acceptance proof complete; fork snapshot reverted.');
}

async function main() {
  const stagingRoot = resolve(tmpdir());
  const captureStage = await mkdtemp(resolve(stagingRoot, 'fxaeon-browser-captures-'));
  try {
    await runProof(captureStage);
  } finally {
    // Only remove this invocation's exact mkdtemp directory, never a caller's
    // output folder. Successful evidence has already been copied after revert.
    assert.equal(dirname(captureStage), stagingRoot);
    assert.ok(basename(captureStage).startsWith('fxaeon-browser-captures-'));
    await rm(captureStage, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
