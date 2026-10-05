import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { canonicalMoveSourceTokenAddress } from '../src/lib/moveBalances';
import { loadWalletTransferHistory, type WalletTransferHistoryDependencies } from '../src/lib/walletTransferHistory';

const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;
const endpoint = (chainId: 1 | 8453, app: string) => `https://${chainId === 1 ? 'eth-mainnet' : 'base-mainnet'}.g.alchemy.com/v2/${app}`;
const urls = (chainId: 1 | 8453) => [endpoint(chainId, 'primary'), endpoint(chainId, 'secondary')];

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    hash,
    from: wallet,
    to: other,
    category: 'external',
    asset: 'UNTRUSTED_SYMBOL',
    rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
    metadata: { blockTimestamp: '2026-01-02T03:04:05.000Z' },
    uniqueId: `${hash}:external:0`,
    ...overrides,
  };
}

function response(transfers: unknown[] = [], pageKey?: string) {
  return {
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: { transfers, ...(pageKey === undefined ? {} : { pageKey }) } }),
  } as Response;
}

function dependencies(fetcher: WalletTransferHistoryDependencies['fetcher'], rpcUrls = urls): WalletTransferHistoryDependencies {
  return { fetcher, getRpcUrls: rpcUrls };
}

test('requests one bounded sent and received page per chain with canonical token filters', async () => {
  const calls: Array<{ url: string; params: Record<string, unknown> }> = [];
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { params: [Record<string, unknown>] };
    calls.push({ url, params: body.params[0] });
    return response();
  }));

  assert.equal(result.partial, false);
  assert.equal(result.items.length, 0);
  assert.equal(calls.length, 4);
  for (const { url, params } of calls) {
    assert.match(url, /^https:\/\/(eth-mainnet|base-mainnet)\.g\.alchemy\.com\/v2\//);
    assert.deepEqual(params.category, ['external', 'internal', 'erc20']);
    assert.equal(params.excludeZeroValue, true);
    assert.equal(params.withMetadata, true);
    assert.equal(params.order, 'desc');
    assert.equal(params.maxCount, '0x14');
    assert.ok(Array.isArray(params.contractAddresses));
    assert.equal(params.fromAddress === wallet || params.toAddress === wallet, true);
    assert.equal(params.fromAddress && params.toAddress, undefined);
  }
  const ethereum = calls.find((call) => call.url.includes('eth-mainnet'))!;
  const base = calls.find((call) => call.url.includes('base-mainnet'))!;
  assert.ok((ethereum.params.contractAddresses as string[]).includes(FX_TOKENS.USDC.address.toLowerCase())
    || (ethereum.params.contractAddresses as string[]).some((address) => address.toLowerCase() === FX_TOKENS.USDC.address.toLowerCase()));
  assert.deepEqual((base.params.contractAddresses as string[]).map((address) => address.toLowerCase()).sort(), [
    canonicalMoveSourceTokenAddress('fxUSD', 8453).toLowerCase(),
    canonicalMoveSourceTokenAddress('fxSAVE', 8453).toLowerCase(),
  ].sort());
});

test('parses exact raw values and canonical metadata while validating sent/received wallet direction', async () => {
  const usdc = FX_TOKENS.USDC.address;
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { params: [Record<string, unknown>] };
    const params = request.params[0];
    const received = params.toAddress === wallet;
    const tokenTransfer = received ? transfer({
      hash: `0x${'b'.repeat(64)}`,
      from: other,
      to: wallet,
      category: 'erc20',
      asset: 'FAKE_SYMBOL',
      rawContract: { value: '0xf4241', address: usdc, decimal: '0x12' },
      uniqueId: 'incoming-usdc-log',
    }) : transfer();
    return response([tokenTransfer]);
  }));

  assert.equal(result.partial, false);
  const native = result.items.find((item) => item.tokenAddress === null)!;
  assert.equal(native.amountRaw, 1_000_000_000_000_000_000n);
  assert.equal(native.symbol, 'ETH');
  assert.equal(native.decimals, 18);
  const token = result.items.find((item) => item.tokenAddress?.toLowerCase() === usdc.toLowerCase())!;
  assert.equal(token.amountRaw, 1_000_001n);
  assert.equal(token.symbol, 'USDC');
  assert.equal(token.decimals, 6);
  assert.equal(token.timestamp, Date.parse('2026-01-02T03:04:05.000Z'));
  assert.equal(token.to.toLowerCase(), wallet.toLowerCase());
});

test('accepts an explicit cursor, returns the next cursor, and never paginates automatically', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const result = await loadWalletTransferHistory(wallet, { 1: { sent: 'prior-sent-page' } }, dependencies(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { params: [Record<string, unknown>] };
    requests.push(body.params[0]);
    return response([], 'next-page-token');
  }));

  assert.equal(requests.length, 1);
  const sent = requests.find((params) => params.fromAddress === wallet)!;
  assert.equal(sent.pageKey, 'prior-sent-page');
  assert.equal(result.cursors[1].sent, 'next-page-token');
  assert.equal(result.cursors[1].received, null);
});

test('falls back only between configured Alchemy endpoints and excludes Infura', async () => {
  const attempts: string[] = [];
  const fallbackUrls = (chainId: 1 | 8453) => [
    endpoint(chainId, 'primary'),
    `https://${chainId === 1 ? 'eth-mainnet' : 'base-mainnet'}.g.alchemy.com/v2/secondary`,
    `https://${chainId === 1 ? 'mainnet' : 'base-mainnet'}.infura.io/v3/project`,
  ];
  let failPrimary = true;
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input) => {
    const url = String(input);
    attempts.push(url);
    if (url.endsWith('/primary') && failPrimary) {
      failPrimary = false;
      throw new Error('network error');
    }
    return response();
  }, fallbackUrls));

  assert.equal(result.partial, false);
  assert.ok(attempts.some((url) => url.endsWith('/secondary')));
  assert.ok(attempts.every((url) => new URL(url).hostname.endsWith('.g.alchemy.com')));
});

test('missing Alchemy configuration returns a partial empty result without throwing', async () => {
  let called = false;
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async () => {
    called = true;
    return response();
  }, () => [`https://mainnet.infura.io/v3/key`]));

  assert.equal(called, false);
  assert.equal(result.partial, true);
  assert.deepEqual(result.items, []);
});

test('malformed rows are ignored and mark the page partial; unsupported assets are ignored safely', async () => {
  const unsupported = '0x3333333333333333333333333333333333333333';
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (_input, init) => {
    const params = (JSON.parse(String(init?.body)) as { params: [Record<string, unknown>] }).params[0];
    if (params.fromAddress !== wallet) return response();
    return response([
      transfer({ hash: 'not-a-hash' }),
      transfer({ rawContract: { value: '0x10', address: unsupported, decimal: '0x12' } }),
    ]);
  }));

  assert.equal(result.partial, true);
  assert.equal(result.items.length, 0);
});

test('RPC timeout settles each direction and returns partial data instead of throwing', async () => {
  const result = await loadWalletTransferHistory(wallet, undefined, {
    ...dependencies(async () => new Promise<Response>(() => {}), (chainId) => [endpoint(chainId, 'only')]),
    timeoutMs: 5,
  });
  assert.equal(result.partial, true);
  assert.deepEqual(result.items, []);
});
