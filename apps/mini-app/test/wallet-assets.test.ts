import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import {
  fetchAlchemyWalletAssets,
  mergeCanonicalWalletAssets,
  parseAlchemyWalletAssets,
  summarizeWalletAssets,
  walletAssetValuation,
  walletAssetCountLabel,
  walletAssetSourcesFailed,
  type WalletAssetSnapshot,
} from '../src/lib/walletAssets';

const wallet = '0x0000000000000000000000000000000000001234';
const now = Date.parse('2026-09-05T00:00:00.000Z');

test('asset counts stay truthful while canonical reads are pending or unavailable', () => {
  assert.equal(walletAssetCountLabel(0, 'loading'), '—');
  assert.equal(walletAssetCountLabel(0, 'unavailable'), '—');
  assert.equal(walletAssetCountLabel(0, 'partial'), '—');
  assert.equal(walletAssetCountLabel(0, 'ready'), '0 assets');
});

test('disabled optional indexing is settled when both canonical chain reads fail', () => {
  assert.equal(walletAssetSourcesFailed(false, false, true, true), true);
  assert.equal(walletAssetSourcesFailed(false, false, false, true), false);
  assert.equal(walletAssetSourcesFailed(true, false, true, true), false);
  assert.equal(walletAssetSourcesFailed(true, true, true, true), true);
});

test('parses exact Alchemy native and ERC-20 balances with validated metadata and prices', () => {
  const payload = { data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1000000000000000', tokenMetadata: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2400.25', lastUpdatedAt: new Date(now).toISOString() }] },
    { address: wallet, network: 'eth-mainnet', tokenAddress: FX_TOKENS.USDC.address, tokenBalance: '900719925474099312345678', tokenMetadata: { symbol: 'USDC', name: 'USD Coin', decimals: 6 }, tokenPrices: [] },
    { address: wallet, network: 'base-mainnet', tokenAddress: '0x1111111111111111111111111111111111111111', tokenBalance: '42', tokenMetadata: { symbol: 'TEST', name: 'Test', decimals: 18, logo: 'https://example.com/logo.svg' }, tokenPrices: [] },
  ] } };
  const snapshot = parseAlchemyWalletAssets(payload, wallet, now);
  const eth = snapshot.assets.find((asset) => asset.chainId === 1 && asset.tokenAddress === null);
  const usdc = snapshot.assets.find((asset) => asset.tokenAddress?.toLowerCase() === FX_TOKENS.USDC.address.toLowerCase());
  assert.equal(eth?.balanceWei, 0x1000000000000000n);
  assert.equal(eth?.priceUsd, 2400.25);
  assert.equal(usdc?.balanceWei, 900719925474099312345678n);
  assert.equal(usdc?.canonicalKey, 'USDC');
  assert.equal(snapshot.assets.find((asset) => asset.symbol === 'TEST')?.logoUrl, null);
});

test('canonical reads replace indexed values and keep unpriced assets visible', () => {
  const indexed: WalletAssetSnapshot = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, tokenPrices: [] },
    { address: wallet, network: 'base-mainnet', tokenAddress: '0x1111111111111111111111111111111111111111', tokenBalance: '10', tokenMetadata: { symbol: 'TEST', name: 'Test', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [{ chainId: 1, balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 2n * 10n ** 18n }], failedTokens: [], updatedAt: now }], { prices: { ETH: 2400 }, status: 'ready', updatedAt: now }, now);
  const eth = merged.assets.find((asset) => asset.chainId === 1 && asset.canonicalKey === 'ETH');
  assert.equal(eth?.balanceWei, 2n * 10n ** 18n);
  assert.equal(merged.assets.some((asset) => asset.symbol === 'TEST'), true);
  assert.equal(merged.unpricedAssetCount, 1);
  const summarized = summarizeWalletAssets(merged, now);
  assert.equal(summarized.totalUsdValue, 4800, 'fresh priced rows remain available as a subtotal');
  assert.equal(summarized.assets.find((asset) => asset.symbol === 'TEST')?.usdValue, null, 'unpriced balances stay excluded');
  assert.equal(walletAssetValuation(summarized).totalUsd, null, 'a partial subtotal is not marked as a complete total');
  assert.equal(walletAssetValuation(summarized).complete, false);
});

test('expired balance or quote reads are removed from the display subtotal by the shared freshness policy', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0xde0b6b3a7640000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now).toISOString() }] },
  ] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [
    { chainId: 1, balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 2n * 10n ** 18n }], failedTokens: [], updatedAt: now },
    { chainId: 8453, balances: [], failedTokens: [], updatedAt: now },
  ], { prices: { ETH: 2000 }, status: 'ready', updatedAt: now }, now);

  const fresh = summarizeWalletAssets(merged, now);
  const expired = summarizeWalletAssets(merged, now + 16 * 60_000);
  assert.equal(fresh.totalUsdValue, 4000);
  assert.equal(expired.totalUsdValue, 0);
  assert.equal(expired.assets.find((asset) => asset.canonicalKey === 'ETH')?.usdValue, null);
  assert.equal(walletAssetValuation(expired).totalUsd, null);
});

test('a seven-minute cached quote remains display-fresh after refresh failure without renewing its timestamp', () => {
  const quoteAt = now - 7 * 60_000;
  const merged = mergeCanonicalWalletAssets(null, wallet, [{
    chainId: 1,
    balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 2n * 10n ** 18n }],
    failedTokens: [],
    updatedAt: now,
  }], {
    prices: { ETH: 2_000 }, status: 'stale', updatedAt: quoteAt, updatedAts: { ETH: quoteAt },
  }, now);
  const eth = merged.assets.find((asset) => asset.canonicalKey === 'ETH');
  assert.equal(eth?.priceStatus, 'fresh');
  assert.equal(eth?.priceUpdatedAt, quoteAt);
  assert.equal(eth?.usdValue, 4_000);
  assert.equal(summarizeWalletAssets(merged, quoteAt + 15 * 60_000 + 1).assets[0]?.priceStatus, 'stale');
});

test('canonical replacement retains prior validated quote metadata when current prices omit the token', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now).toISOString() }] },
  ] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [{ chainId: 1, balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 2n }], failedTokens: [], updatedAt: now + 1_000 }], { prices: {}, status: 'ready', updatedAt: now + 1_000 }, now + 1_000);
  const eth = merged.assets.find((asset) => asset.canonicalKey === 'ETH');
  assert.equal(eth?.balanceWei, 2n);
  assert.equal(eth?.priceUsd, 2000);
  assert.equal(eth?.priceUpdatedAt, now);
  assert.equal(eth?.usdValue, 4e-15, 'the old quote remains fresh at the supplied timestamp without being re-stamped');
});

test('canonical rows use their own quote timestamp instead of the oldest unrelated quote', () => {
  const merged = mergeCanonicalWalletAssets(null, wallet, [{
    chainId: 1,
    balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 1n * 10n ** 18n }],
    failedTokens: [],
    updatedAt: now,
  }], {
    prices: { ETH: 2400, FXN: 1 },
    status: 'ready',
    updatedAt: now - 10 * 60_000,
    updatedAts: { ETH: now, FXN: now - 10 * 60_000 },
  }, now);
  const eth = merged.assets.find((asset) => asset.canonicalKey === 'ETH');
  assert.equal(eth?.priceUpdatedAt, now);
  assert.equal(eth?.usdValue, 2400);
});

test('conflicting duplicates remain excluded even when a third row repeats an earlier balance', () => {
  const row = { address: wallet, network: 'base-mainnet', tokenAddress: '0x1111111111111111111111111111111111111111', tokenBalance: '10', tokenMetadata: { symbol: 'TEST', decimals: 18 } };
  const snapshot = parseAlchemyWalletAssets({ data: { tokens: [row, { ...row, tokenBalance: '20' }, row] } }, wallet, now);
  assert.equal(snapshot.assets.length, 0);
  assert.equal(snapshot.networks[8453].status, 'partial');
});

test('canonical successes do not claim complete discovery after an indexed network failure', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [] }, error: { partialErrors: [{ network: 'base-mainnet' }] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [{ chainId: 8453, balances: [], failedTokens: [], updatedAt: now }], { prices: {}, status: 'ready', updatedAt: now }, now);
  assert.equal(merged.networks[8453].status, 'partial');
});

test('pending canonical reads keep the aggregate incomplete', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [
    { chainId: 1, balances: [], failedTokens: [], updatedAt: now, status: 'pending' },
    { chainId: 8453, balances: [], failedTokens: [], updatedAt: now, status: 'pending' },
  ], { prices: { ETH: 2400 }, status: 'ready', updatedAt: now }, now);
  assert.equal(merged.networks[1].status, 'pending');
  assert.equal(merged.networks[8453].status, 'pending');
});

test('treats top-level and per-token Alchemy errors as incomplete while retaining balances', () => {
  const timestamp = new Date(now).toISOString();
  const token = { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', name: 'Ethereum', decimals: 18 }, error: { message: 'price unavailable' }, tokenPrices: [] };
  const partial = parseAlchemyWalletAssets({ data: { tokens: [token] }, error: { partialErrors: [] } }, wallet, now);
  assert.equal(partial.networks[1].status, 'partial');
  assert.equal(partial.networks[8453].status, 'partial');
  assert.equal(partial.assets[0].balanceWei, 1n);
  assert.equal(partial.assets[0].usdValue, null);
  const tokenPartial = parseAlchemyWalletAssets({ data: { tokens: [{ ...token, error: 'metadata unavailable', tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: timestamp }] }] } }, wallet, now);
  assert.equal(tokenPartial.networks[1].status, 'partial');
  assert.equal(tokenPartial.assets[0].priceUsd, 2000);
});

test('freshly retries only networks reported in Alchemy partialErrors and keeps later pages', async () => {
  const calls: Array<{ networks: string[]; pageKey?: string }> = [];
  const timestamp = new Date().toISOString();
  const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  const request: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { addresses: [{ networks: string[] }]; pageKey?: string };
    calls.push({ networks: body.addresses[0].networks, pageKey: body.pageKey });
    if (!body.pageKey && body.addresses[0].networks.length === 2) return response({ data: { pageKey: 'base-page', tokens: [{ address: wallet, network: 'base-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [] }] }, error: { partialErrors: [{ network: 'eth-mainnet', message: 'Internal server error' }] } });
    if (body.pageKey === 'base-page') return response({ data: { tokens: [{ address: wallet, network: 'base-mainnet', tokenAddress: '0x1111111111111111111111111111111111111111', tokenBalance: '0x2', tokenMetadata: { symbol: 'TEST', decimals: 18 }, tokenPrices: [] }] } });
    if (!body.pageKey && body.addresses[0].networks.length === 1 && body.addresses[0].networks[0] === 'eth-mainnet') return response({ data: { tokens: [{ address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x3', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: timestamp }] }] } });
    throw new Error('unexpected Alchemy request');
  };
  const snapshot = await fetchAlchemyWalletAssets(wallet, undefined, request, 'test-api-key');
  assert.deepEqual(calls.map(({ networks, pageKey }) => [networks, pageKey]), [
    [['eth-mainnet', 'base-mainnet'], undefined],
    [['eth-mainnet', 'base-mainnet'], 'base-page'],
    [['eth-mainnet'], undefined],
  ]);
  assert.equal(snapshot.networks[1].status, 'ready');
  assert.equal(snapshot.networks[8453].status, 'ready');
  assert.equal(snapshot.assets.find((asset) => asset.chainId === 1)?.balanceWei, 3n);
  assert.equal(snapshot.assets.find((asset) => asset.chainId === 8453 && asset.tokenAddress === null)?.balanceWei, 1n);
  assert.equal(snapshot.assets.find((asset) => asset.symbol === 'TEST')?.balanceWei, 2n);
});

test('pending refresh preserves canonical rows without restamping cached values', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0xde0b6b3a7640000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now).toISOString() }] },
  ] } }, wallet, now);
  const first = mergeCanonicalWalletAssets(indexed, wallet, [{ chainId: 1, balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 2n * 10n ** 18n }], failedTokens: [], updatedAt: now + 1_000 }], { prices: { ETH: 2400 }, status: 'ready', updatedAt: now + 1_000 }, now + 1_000);
  const before = first.assets.find((asset) => asset.canonicalKey === 'ETH');
  assert.ok(before);
  const pending = mergeCanonicalWalletAssets(first, wallet, [{ chainId: 1, balances: [{ key: 'ETH', address: null, decimals: 18, amountWei: 3n * 10n ** 18n }], failedTokens: [], updatedAt: now + 2_000, status: 'pending' }], { prices: {}, status: 'ready', updatedAt: now + 2_000 }, now + 2_000);
  const after = pending.assets.find((asset) => asset.canonicalKey === 'ETH');
  assert.deepEqual(after, before);
  assert.equal(pending.networks[1].status, 'pending');
  assert.equal(walletAssetValuation(pending).totalUsd, null);
});

test('a completed canonical zero removes the prior row and can produce a verified zero total', () => {
  const indexed = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const merged = mergeCanonicalWalletAssets(indexed, wallet, [
    { chainId: 1, balances: [], failedTokens: [], updatedAt: now },
    { chainId: 8453, balances: [], failedTokens: [], updatedAt: now },
  ], { prices: {}, status: 'ready', updatedAt: now }, now);
  assert.equal(merged.assets.length, 0);
  assert.equal(merged.networks[1].status, 'ready');
  assert.equal(merged.networks[8453].status, 'ready');
  assert.equal(walletAssetValuation(merged).totalUsd, 0);
});

test('portfolio and wallet profile hide an incomplete headline total', () => {
  const snapshot = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0xde0b6b3a7640000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now).toISOString() }] },
    { address: wallet, network: 'base-mainnet', tokenAddress: '0x1111111111111111111111111111111111111111', tokenBalance: '10', tokenMetadata: { symbol: 'TEST', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const valuation = walletAssetValuation(snapshot);
  assert.equal(valuation.assetCount, 2);
  assert.equal(valuation.unpricedAssetCount, 1);
  assert.equal(valuation.totalUsd, null);
  assert.equal(valuation.complete, false);
  assert.match(valuation.reason, /1 asset is waiting/);
});
