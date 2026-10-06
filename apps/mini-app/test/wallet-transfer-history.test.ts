import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { positionPoolAddress } from '../src/lib/fx/policy';
import {
  hasMoreWalletTransfers,
  loadWalletTransferHistory,
  nextWalletTransferCursors,
  resetWalletTransferHistoryForTests,
  type WalletTransferHistoryDependencies,
} from '../src/lib/walletTransferHistory';

const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;
const endpoint = (chainId: 1 | 8453, app: string) => `https://${chainId === 1 ? 'eth-mainnet' : 'base-mainnet'}.g.alchemy.com/v2/${app}`;
const urls = (chainId: 1 | 8453) => [endpoint(chainId, 'primary'), endpoint(chainId, 'secondary')];
const POOLS = (['ETH', 'BTC'] as const).flatMap((market) => (['long', 'short'] as const).map((side) => positionPoolAddress(market, side).toLowerCase())).sort();

type Params = Record<string, unknown> & { category: string[] };
const isNftRequest = (params: Params) => params.category.includes('erc721');

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

const paramsOf = (init?: RequestInit) => (JSON.parse(String(init?.body)) as { params: [Params] }).params[0];

test.beforeEach(() => resetWalletTransferHistoryForTests());

// Intended change: History used to filter the request to canonical token
// contracts and silently drop every other ERC-20. It now reads every ERC-20
// (canonical ones are marked verified) and adds f(x) position NFT streams.
test('requests every ERC-20 without a token filter, and position NFTs only from the four f(x) pools', async () => {
  const calls: Array<{ url: string; params: Params }> = [];
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input, init) => {
    calls.push({ url: String(input), params: paramsOf(init) });
    return response();
  }));

  assert.equal(result.partial, false);
  assert.equal(result.items.length, 0);
  // Without a pageKey every stream stops after its first page.
  assert.equal(calls.length, 6);
  for (const { url, params } of calls) {
    assert.match(url, /^https:\/\/(eth-mainnet|base-mainnet)\.g\.alchemy\.com\/v2\//);
    assert.equal(params.excludeZeroValue, true);
    assert.equal(params.withMetadata, true);
    assert.equal(params.order, 'desc');
    assert.equal(params.maxCount, '0x14');
    assert.equal(params.fromAddress === wallet || params.toAddress === wallet, true);
    assert.equal(params.fromAddress && params.toAddress, undefined);
  }
  const fungible = calls.filter((call) => !isNftRequest(call.params));
  assert.equal(fungible.length, 4);
  for (const { params } of fungible) {
    assert.deepEqual(params.category, ['external', 'internal', 'erc20']);
    assert.equal('contractAddresses' in params, false);
  }
  const nft = calls.filter((call) => isNftRequest(call.params));
  assert.equal(nft.length, 2);
  for (const { url, params } of nft) {
    assert.match(url, /eth-mainnet/);
    assert.deepEqual(params.category, ['erc721']);
    assert.deepEqual((params.contractAddresses as string[]).map((address) => address.toLowerCase()).sort(), POOLS);
  }
});

test('parses exact raw values and canonical metadata while validating sent/received wallet direction', async () => {
  const usdc = FX_TOKENS.USDC.address;
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (_input, init) => {
    const params = paramsOf(init);
    if (isNftRequest(params)) return response();
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
  assert.equal(native.verified, true);
  const token = result.items.find((item) => item.tokenAddress?.toLowerCase() === usdc.toLowerCase())!;
  assert.equal(token.amountRaw, 1_000_001n);
  // A canonical token keeps canonical metadata, never the indexer's symbol or decimals.
  assert.equal(token.symbol, 'USDC');
  assert.equal(token.decimals, 6);
  assert.equal(token.verified, true);
  assert.equal(token.timestamp, Date.parse('2026-01-02T03:04:05.000Z'));
  assert.equal(token.to.toLowerCase(), wallet.toLowerCase());
});

test('keeps ERC-20s outside the canonical list as unverified, with sanitized indexer metadata', async () => {
  const unknown = '0x3333333333333333333333333333333333333333';
  const nameless = '0x4444444444444444444444444444444444444444';
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input, init) => {
    const params = paramsOf(init);
    if (isNftRequest(params) || params.toAddress !== wallet || !String(input).includes('eth-mainnet')) return response();
    return response([
      transfer({ from: other, to: wallet, category: 'erc20', asset: `${String.fromCodePoint(0x202e)}CLAIM${String.fromCodePoint(0)} REWARDS AT EXAMPLE`, rawContract: { value: '0x10', address: unknown, decimal: '0x9' }, uniqueId: 'spam-1' }),
      transfer({ from: other, to: wallet, category: 'erc20', asset: null, rawContract: { value: '0x20', address: nameless, decimal: null }, uniqueId: 'spam-2' }),
      transfer({ from: other, to: wallet, category: 'erc20', asset: 'ZERO', rawContract: { value: '0x0', address: nameless, decimal: '0x12' }, uniqueId: 'zero' }),
    ]);
  }));

  assert.equal(result.partial, false);
  assert.equal(result.items.length, 2, 'zero-value transfers are dropped; every other ERC-20 is kept');
  const labelled = result.items.find((item) => item.tokenAddress?.toLowerCase() === unknown)!;
  assert.equal(labelled.verified, false);
  assert.equal(labelled.symbol, 'CLAIM REWARDS A…');
  assert.equal(labelled.decimals, 9);
  assert.equal(labelled.amountRaw, 16n);
  const bare = result.items.find((item) => item.tokenAddress?.toLowerCase() === nameless)!;
  assert.equal(bare.verified, false);
  assert.equal(bare.symbol, '0x4444…4444');
  assert.equal(bare.decimals, null);
});

test('reads f(x) position NFT movements as evidence and rejects any other collection', async () => {
  const pool = positionPoolAddress('ETH', 'long');
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (_input, init) => {
    const params = paramsOf(init);
    if (!isNftRequest(params)) return response();
    if (params.toAddress === wallet) {
      return response([{ hash, from: other, to: wallet, category: 'erc721', tokenId: '0x0c', erc721TokenId: '0x0c',
        rawContract: { value: null, address: pool.toLowerCase(), decimal: null }, metadata: { blockTimestamp: '2026-01-02T03:04:05.000Z' }, uniqueId: `${hash}:log:4` }]);
    }
    return response([{ hash, from: wallet, to: other, category: 'erc721', tokenId: '0x01',
      rawContract: { value: null, address: '0x5555555555555555555555555555555555555555', decimal: null }, metadata: { blockTimestamp: '2026-01-02T03:04:05.000Z' } }]);
  }));
  assert.equal(result.items.length, 0);
  assert.equal(result.positionTransfers.length, 1);
  const [nft] = result.positionTransfers;
  assert.equal(nft.pool.toLowerCase(), pool.toLowerCase());
  assert.equal(nft.tokenId, 12n);
  assert.equal(nft.to.toLowerCase(), wallet);
  assert.equal(result.partial, true, 'an NFT outside the requested pools is not trusted');
});

test('a first load reads two pages per stream, stops early without a pageKey, and only fungible cursors offer more rows', async () => {
  const requests: Array<{ url: string; params: Params }> = [];
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input, init) => {
    const params = paramsOf(init);
    const url = String(input);
    requests.push({ url, params });
    if (url.includes('base-mainnet') || isNftRequest(params)) return response();
    const page = typeof params.pageKey === 'string' ? Number(params.pageKey.slice(-1)) + 1 : 1;
    const direction = params.fromAddress === wallet ? 'sent' : 'received';
    return response([transfer({
      hash: `0x${String(page).repeat(64)}`,
      ...(direction === 'received' ? { from: other, to: wallet } : {}),
      uniqueId: `${direction}-${page}`,
    })], `${direction}-page-${page}`);
  }));
  const sentPages = (host: string) => requests.filter(({ url, params }) => url.includes(host) && !isNftRequest(params) && params.fromAddress === wallet)
    .map(({ params }) => params.pageKey ?? null);
  assert.deepEqual(sentPages('eth-mainnet'), [null, 'sent-page-1'], 'Ethereum reads page 1 and follows one pageKey');
  assert.deepEqual(sentPages('base-mainnet'), [null], 'an empty Base page has no pageKey to follow');
  assert.equal(requests.length, 2 + 2 + 2 + 2, 'Ethereum fungible streams read two pages; NFT and Base streams stop after one');
  assert.equal(result.items.length, 4);
  assert.equal(result.cursors[1].sent, 'sent-page-2');
  assert.equal(result.cursors[1].received, 'received-page-2');
  assert.equal(result.cursors[8453].sent, null);
  assert.equal(hasMoreWalletTransfers(result), true);
  assert.deepEqual(nextWalletTransferCursors(result), { 1: { sent: 'sent-page-2', received: 'received-page-2' } });
  const nftOnly = { cursors: { 1: { sent: null, received: null, positionsSent: 'nft', positionsReceived: null }, 8453: { sent: null, received: null, positionsSent: null, positionsReceived: null } } };
  assert.equal(hasMoreWalletTransfers(nftOnly), false);
});

test('accepts an explicit cursor, returns the next cursor, and never paginates automatically', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const result = await loadWalletTransferHistory(wallet, { 1: { sent: 'prior-sent-page' } }, dependencies(async (_input, init) => {
    requests.push(paramsOf(init));
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

test('a network without internal transfers is retried without that category', async () => {
  const baseCategories: string[][] = [];
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (input, init) => {
    const params = paramsOf(init);
    if (!String(input).includes('base-mainnet')) return response();
    baseCategories.push(params.category);
    if (params.category.includes('internal')) {
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'internal category is only supported for ETH and MATIC' } }) } as Response;
    }
    return response(params.fromAddress === wallet ? [transfer({ uniqueId: 'base-native' })] : []);
  }));
  assert.equal(result.partial, false);
  assert.equal(result.items.filter((item) => item.chainId === 8453).length, 1);
  // Each Base stream learns once; later requests omit the category from the start.
  assert.ok(baseCategories.some((categories) => categories.includes('internal')));
  assert.deepEqual(baseCategories[baseCategories.length - 1], ['external', 'erc20']);
  // A generic internal error is an outage, not an unsupported category.
  resetWalletTransferHistoryForTests();
  const outage = await loadWalletTransferHistory(wallet, undefined, dependencies(async () => (
    { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }) } as Response)));
  assert.equal(outage.partial, true);
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

// Intended change: an unsupported ERC-20 is no longer dropped (see the
// unverified test above). A native transfer that names a token contract is
// inconsistent indexer output and is now treated as malformed.
test('malformed rows, including a native transfer that names a token contract, are ignored and mark the page partial', async () => {
  const unsupported = '0x3333333333333333333333333333333333333333';
  const result = await loadWalletTransferHistory(wallet, undefined, dependencies(async (_input, init) => {
    const params = paramsOf(init);
    if (params.fromAddress !== wallet || isNftRequest(params)) return response();
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
