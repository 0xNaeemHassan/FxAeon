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
import { tokenAddress } from '../../src/app/trade/fxUi';
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

async function waitForExit(child: ChildProcess, label = 'Next build'): Promise<void> {
  await new Promise<void>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`${label} exited ${code}`)));
  });
}

async function runProof(captureStage: string) {
  await mkdir(artifactRoot, { recursive: true });
  assert.equal(await rpc('eth_chainId'), '0x1');
  assert.match(await rpc<string>('web3_clientVersion'), /anvil/i, 'never use a real RPC for this test');
  const [wallet, alternateWallet] = await rpc<Address[]>('eth_accounts');
  assert.ok(wallet && alternateWallet, 'Anvil must expose disposable accounts for session isolation checks');
  let selectedWallet: Address | null = wallet;
  const forkBlock = await client.getBlockNumber();
  if (process.env.ANVIL_FORK_BLOCK) assert.equal(forkBlock, BigInt(process.env.ANVIL_FORK_BLOCK), 'fork must use the requested pinned block');
  const snapshot = await rpc<string>('evm_snapshot');
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Page | undefined;
  const miningTasks: Promise<unknown>[] = [];
  const miningErrors: string[] = [];
  const submitted: Array<{ hash: Hex; to: string }> = [];
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
      const tx = request.params?.[0] as { from: string; to: string };
      assert.equal(tx.from.toLowerCase(), wallet.toLowerCase());
      const hash = await rpc<Hex>('eth_sendTransaction', [tx]);
      heldReceipts.set(hash.toLowerCase(), receiptHold());
      submitted.push({ hash, to: tx.to });
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
            // Keep a real, already-owned NFT undiscoverable until the UI has
            // proved both its receipt-backed placeholder and reload recovery.
            // Never substitute any contract accounting or fabricate an ID.
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
    const runBrowserProof = async () => {
      const page = activePage;
    // A real connected session must never display another account's balance.
    // Exercise this without reloading, so the shared query cache stays mounted.
    await page.goto(`${baseUrl}/trade`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    const sessionUsdcOption = page.getByRole('option', { name: /^USDC(?: selected)?$/ });
    const fundedUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
    const alternateUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [alternateWallet] });
    assert.notEqual(fundedUsdc, alternateUsdc, 'session balances must be distinguishable');
    const availableLabel = (value: bigint) => `Available: ${formatExactDecimal(formatUnits(value, 6), 4)} USDC`;
    await expect(sessionUsdcOption).toContainText(availableLabel(fundedUsdc));
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(alternateWallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' }))
      .toContainText(`${alternateWallet.slice(0, 5)}…${alternateWallet.slice(-4)}`);
    // ProtocolPositionSession intentionally remounts account-owned UI. The
    // outer Wagmi cache remains mounted; reopen the new session's picker.
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    assert.ok(!(await sessionUsdcOption.innerText()).includes(availableLabel(fundedUsdc)),
      'the previous balance must disappear as soon as the new wallet identity is shown');
    await expect(sessionUsdcOption).toContainText(availableLabel(alternateUsdc));
    await expect(sessionUsdcOption).not.toContainText(availableLabel(fundedUsdc));
    await page.evaluate('window.__fxForkChangeAccount(null)');
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    assert.ok(!/Available: [\d,]/.test(await sessionUsdcOption.innerText()), 'disconnected picker must clear owned quantities');
    await expect(sessionUsdcOption).not.toContainText(/Available: [\d,]/);
    await page.evaluate(`window.__fxForkChangeAccount(${JSON.stringify(wallet)})`);
    await expect(page.getByRole('button', { name: 'Open wallet profile' }))
      .toContainText(`${wallet.slice(0, 5)}…${wallet.slice(-4)}`);
    await page.getByRole('button', { name: 'Input asset', exact: true }).click();
    await expect(sessionUsdcOption).toContainText(availableLabel(fundedUsdc));
    assert.equal(submitted.length, 0, 'session checks must never request a signature');
    console.log('Live balance account-switch and disconnect isolation verified');
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
      await page.getByRole('button', { name: 'Input asset', exact: true }).click();
      const usdcOption = page.getByRole('option', { name: /^USDC(?: selected)?$/ });
      const availableUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await expect(usdcOption).toContainText(`Available: ${formatExactDecimal(formatUnits(availableUsdc, 6), 4)} USDC`);
      await usdcOption.click();
      await page.getByLabel('Amount in USDC', { exact: true }).fill('1000');
      await page.getByRole('spinbutton', { name: scenario.side === 'short' ? 'Target LSD leverage' : 'Target leverage', exact: true }).fill(scenario.side === 'short' ? '0.5' : '2');
      await page.locator('summary').filter({ hasText: /^Advanced/ }).click();
      await page.getByLabel('Slippage tolerance percentage').fill('1');
      await page.getByRole('button', { name: `Review ${scenario.market} ${scenario.side === 'long' ? 'Long' : 'Short'}`, exact: true }).click();
      console.log(`Browser requested ${scenario.market} ${scenario.side} review`);
      await expect(page.getByRole('checkbox')).toBeVisible({ timeout: 180_000 });
      assert.equal(submitted.length, signedBefore, 'review must never request a signature');
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-review.png`), fullPage: true });
      await page.getByRole('checkbox').check();
      const confirmButton: Locator = page.getByRole('button', { name: /^Confirm (?:in wallet|\d+ transactions)$/ });
      const countMatch: RegExpMatchArray | null = (await confirmButton.innerText()).match(/Confirm (\d+) transactions/);
      const transactionCount: number = countMatch ? Number(countMatch[1]) : 1;
      assert.ok(transactionCount >= 1 && transactionCount <= 10, 'review must expose the ordered transaction count');
      await confirmButton.click();
      for (let transactionIndex = 0; transactionIndex < transactionCount; transactionIndex += 1) {
        await expect.poll(() => proofValue(submitted.length), { timeout: 180_000 }).toBe(signedBefore + transactionIndex + 1);
        const tx = submitted[signedBefore + transactionIndex];
        const hold = heldReceipts.get(tx.hash.toLowerCase());
        assert.ok(hold, 'each actual broadcast must be held before browser receipt completion');
        await expect.poll(() => proofValue(hold.intercepted)).toBeGreaterThan(0);
        const explorer = page.locator('section[aria-label="Submitted transactions"]')
          .locator(`a[href="https://etherscan.io/tx/${tx.hash}"]`);
        await expect(explorer).toBeVisible();
        const kind = tx.to.toLowerCase() === usdc ? 'Approval' : 'Action';
        await expect(explorer).toHaveAccessibleName(new RegExp(`^${kind} ${transactionIndex + 1}: Submitted\\.`));
        const bounds = await explorer.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, 'submitted explorer target must be at least 44px');
        await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
        await expect(confirmButton).toHaveCount(0);
        assert.equal(submitted.length, signedBefore + transactionIndex + 1, 'no later step may sign before this receipt is delivered');
        submittedExplorerHashes.add(tx.hash.toLowerCase());
        await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-submitted-${transactionIndex + 1}.png`), fullPage: true });
        hold.release();
      }

      const pendingCard = page.locator(`[data-confirmed-position-key="${key}"]`).first();
      await expect(pendingCard).toBeVisible({ timeout: 180_000 });
      await expect(pendingCard).toContainText('Details updating');
      await expect(pendingCard).not.toContainText('Est. net equity');
      await expect(page.locator(`[data-position-key="${key}"]`)).toHaveCount(0);
      assert.equal(emittedDiscoveries.has(key), false, 'confirmed placeholder must precede index discovery');
      confirmedBeforeIndexer.add(key);
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible({ timeout: 180_000 });
      await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
      const remainingUsdc = await client.readContract({ address: usdc, abi: tokenAbi, functionName: 'balanceOf', args: [wallet] });
      await expect(page.locator('.trade-ticket')).toContainText(`Available: ${formatExactDecimal(formatUnits(remainingUsdc, 6), 4)} USDC`);
      const own = await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(positionId)] });
      assert.equal(own.toLowerCase(), wallet.toLowerCase());
      const [collateral, debt] = await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(positionId)] });
      assert.ok(collateral > 0n && debt > 0n);
      assert.equal(Number(await client.readContract({ address: scenario.pool, abi: poolAbi, functionName: 'getNextPositionId' })), positionId + 1);
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
      await expect(pendingCard.getByRole('link', { name: 'View confirmed position transaction', exact: true }))
        .toHaveAttribute('href', `https://etherscan.io/tx/${actionHash}`);
      positions.push({ ...scenario, positionId, rawCollateral: collateral.toString(), rawDebt: debt.toString(), transactions });
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-confirmed-pending.png`), fullPage: true });

      await page.reload();
      await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('radiogroup', { name: 'Market', exact: true }).getByRole('radio', { name: scenario.market, exact: true }).click();
      await page.getByRole('radiogroup', { name: 'Position side' }).getByRole('radio', { name: scenario.side === 'long' ? 'Long' : 'Short', exact: true }).click();
      await expect(pendingCard).toBeVisible();
      await expect(pendingCard).toContainText('Details updating');
      await expect(pendingCard.getByRole('link', { name: 'View confirmed position transaction', exact: true }))
        .toHaveAttribute('href', `https://etherscan.io/tx/${actionHash}`);
      await expect(page.locator(`[data-position-key="${key}"]`)).toHaveCount(0);
      assert.equal(emittedDiscoveries.has(key), false, 'reloaded placeholder must still precede index discovery');
      await expect.poll(() => proofValue(delayedDiscoveries.get(key) ?? 0)).toBeGreaterThanOrEqual(2);
      restoredConfirmed.add(key);
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-restored-pending.png`), fullPage: true });

      blockedDiscoveries.delete(key);
      await expect(page.locator(`[data-position-key="${key}"]`).first()).toBeVisible();
      await expect(pendingCard).toHaveCount(0);
      assert.equal(emittedDiscoveries.has(key), true, 'full position details require actual SDK index discovery');
      await page.screenshot({ path: resolve(artifactRoot, `${scenario.market}-${scenario.side}-confirmed.png`), fullPage: true });
      console.log(`Browser opened and rendered ${scenario.market} ${scenario.side} #${positionId}`);
    }

    await page.goto(`${baseUrl}/positions`);
    for (const position of positions) {
      await expect(page.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`).first()).toBeVisible();
      await expect(page.locator(`[data-position-key="${position.market}:${position.side}:${position.positionId}"]`).first()).toContainText('Est. net equity');
      assert.equal((await client.readContract({ address: position.pool, abi: poolAbi, functionName: 'ownerOf', args: [BigInt(position.positionId)] })).toLowerCase(), wallet.toLowerCase());
      const [collateral, debt] = await client.readContract({ address: position.pool, abi: poolAbi, functionName: 'getPosition', args: [BigInt(position.positionId)] });
      assert.ok(collateral > 0n && debt > 0n, 'all positions must coexist after the fourth trade');
    }
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
    await page.getByRole('button', { name: 'Review position update', exact: true }).click();
    const borrowDialog = page.getByRole('dialog', { name: 'Update collateral position', exact: true });
    await expect(borrowDialog).toBeVisible({ timeout: 180_000 });
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'borrow review must lock background scrolling');
    assert.equal(submitted.length, borrowSignedBefore, 'borrow review must not request a signature');
    await borrowDialog.getByRole('checkbox').check();
    const confirmBorrow = borrowDialog.getByRole('button', { name: /^Confirm (?:in wallet|\d+ transactions)$/ });
    const borrowCountMatch = (await confirmBorrow.innerText()).match(/Confirm (\d+) transactions/);
    const borrowTransactionCount = borrowCountMatch ? Number(borrowCountMatch[1]) : 1;
    assert.ok(borrowTransactionCount >= 1 && borrowTransactionCount <= 10, 'borrow review must expose the ordered transaction count');
    await confirmBorrow.click();
    for (let transactionIndex = 0; transactionIndex < borrowTransactionCount; transactionIndex += 1) {
      await expect.poll(() => proofValue(submitted.length), { timeout: 180_000 }).toBe(borrowSignedBefore + transactionIndex + 1);
      const tx = submitted[borrowSignedBefore + transactionIndex];
      const hold = heldReceipts.get(tx.hash.toLowerCase());
      assert.ok(hold, 'each borrow broadcast must be held before browser receipt completion');
      await expect.poll(() => proofValue(hold.intercepted)).toBeGreaterThan(0);
      const explorer = page.locator('section[aria-label="Submitted transactions"]')
        .locator(`a[href="https://etherscan.io/tx/${tx.hash}"]`);
      await expect(explorer).toBeVisible();
      await expect(explorer).toHaveAccessibleName(new RegExp(`^(?:Approval|Action) ${transactionIndex + 1}: Submitted\\.`));
      submittedExplorerHashes.add(tx.hash.toLowerCase());
      assert.equal(submitted.length, borrowSignedBefore + transactionIndex + 1, 'borrow steps must remain receipt-ordered');
      hold.release();
    }
    const confirmedBorrowDialog = page.getByRole('dialog', { name: 'Confirmed', exact: true });
    await expect(confirmedBorrowDialog.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible({ timeout: 180_000 });
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
    await confirmedBorrowDialog.getByRole('button', { name: 'Done', exact: true }).click();
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
      const drawer = page.getByRole('dialog', { name: 'Wallet profile', exact: true });
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
    assert.equal(confirmedBeforeIndexer.size, scenarios.length, 'all four confirmed positions need pre-index feedback');
    assert.equal(restoredConfirmed.size, scenarios.length, 'all four confirmed placeholders must recover after reload');
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
        FX_SCREENSHOT_CAPTURE_PROFILE: 'positions', FX_SCREENSHOT_MARKET_DATA: 'live',
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
      const closeUsdcOption = page.getByRole('option', { name: /^USDC(?: selected)?$/ });
      await expect(closeUsdcOption).toContainText(availableLabel(usdcBeforeClose));
      await closeUsdcOption.click();
      await page.locator('summary').filter({ hasText: /^Advanced/ }).click();
      await page.getByLabel('Slippage tolerance percentage').fill('1');
      await page.getByRole('button', { name: 'Review close', exact: true }).click();
      const closeDialog = page.getByRole('dialog', { name: `Close ${position.market} ${position.side} position`, exact: true });
      await expect(closeDialog).toBeVisible({ timeout: 180_000 });
      await expect(closeDialog.getByRole('heading', { name: `Close ${position.market} ${position.side} position`, exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'review overlay must lock background scrolling');
      await expect(page.getByText('Close position', { exact: true })).toBeVisible();
      assert.equal(submitted.length, signedBefore, 'close review must never request a signature');
      await page.screenshot({ path: resolve(artifactRoot, `${position.market}-${position.side}-close-review.png`), fullPage: true });
      await page.getByRole('checkbox').check();
      const confirmClose: Locator = page.getByRole('button', { name: /^Confirm (?:in wallet|\d+ transactions)$/ });
      const closeCountMatch = (await confirmClose.innerText()).match(/Confirm (\d+) transactions/);
      const closeTransactionCount = closeCountMatch ? Number(closeCountMatch[1]) : 1;
      assert.ok(closeTransactionCount >= 1 && closeTransactionCount <= 10, 'close review must expose the ordered transaction count');
      await confirmClose.click();
      for (let transactionIndex = 0; transactionIndex < closeTransactionCount; transactionIndex += 1) {
        await expect.poll(() => proofValue(submitted.length), { timeout: 180_000 }).toBe(signedBefore + transactionIndex + 1);
        const tx = submitted[signedBefore + transactionIndex];
        const hold = heldReceipts.get(tx.hash.toLowerCase());
        assert.ok(hold, 'each close broadcast must be held before browser receipt completion');
        await expect.poll(() => proofValue(hold.intercepted)).toBeGreaterThan(0);
        const explorer = page.locator('section[aria-label="Submitted transactions"]')
          .locator(`a[href="https://etherscan.io/tx/${tx.hash}"]`);
        await expect(explorer).toBeVisible();
        await expect(explorer).toHaveAccessibleName(new RegExp(`^(?:Approval|Action) ${transactionIndex + 1}: Submitted\\.`));
        submittedExplorerHashes.add(tx.hash.toLowerCase());
        assert.equal(submitted.length, signedBefore + transactionIndex + 1, 'close steps must remain receipt-ordered');
        hold.release();
      }
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
    await expect(page.getByText('No open positions', { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(artifactRoot, 'positions-all-closed.png'), fullPage: true });
    assert.equal(closedPositions.length, scenarios.length, 'every supported position must close through the browser');
    assert.ok(existingBorrowProof, 'existing-position borrow must complete through the browser');
    completed = true;
    await context.tracing.stop({ path: resolve(artifactRoot, 'trace.zip') });
    };
    await Promise.race([
      runBrowserProof(),
      routeFailure.then(error => { throw error; }),
    ]);
  } catch (error) {
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
      delayedIndexDiscoveryVerified: true, snapshotRevertedAfterProof: true,
      availableTokenBalancesVerified: true, postConfirmationBalanceRefreshVerified: true,
      walletAccountSwitchIsolationVerified: true, disconnectedBalanceClearVerified: true,
      submittedExplorerBeforeConfirmation: true, confirmedPositionBeforeIndexer: true, restoredConfirmedPosition: true,
      positionUsdLabelsVerified: true, directCloseActionVerified: true,
      existingLongBorrowDeepLinkVerified: true, existingLongBorrowExecuted: true,
      borrowedFxUsdReceived: true, existingLongPositionIdPreserved: true,
      instantReviewOverlayVerified: true,
      everySupportedPositionClosed: true, closeOutputBalanceRefreshVerified: true,
      readSurfaces: ['trade', 'positions', 'portfolio', 'earn', 'move'] }, positions, existingBorrow: existingBorrowProof, closedPositions }, null, 2));
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
