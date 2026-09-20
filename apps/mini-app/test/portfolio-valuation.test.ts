import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { canonicalWalletBalancesSnapshot, knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances } from '../src/lib/portfolioValuation';
import { parseAlchemyWalletAssets, walletAssetValuation } from '../src/lib/walletAssets';

const wallet = '0x930feae1b277ff60b836d2ce27f162555ab598b9';
const now = Date.now();

test('uses a fresh canonical ETH balance when expanded asset rows are present but unpriced', () => {
  const expanded = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [] },
    { address: wallet, network: 'base-mainnet', tokenAddress: '0x2222222222222222222222222222222222222222', tokenBalance: '0x2', tokenMetadata: { symbol: 'Other', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const balances = {
    balances: [{ key: 'ETH' as const, address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 600_000_000_000_000n }],
    failedTokens: [],
  };
  const prices = {
    prices: { ETH: 2_000 }, status: 'stale' as const, updatedAt: now - 60 * 60_000, updatedAts: { ETH: now },
  };
  const displaySnapshot = mergeFreshCanonicalWalletBalances(expanded, balances, now, prices, now);
  const result = knownFreshPortfolioSubtotal(displaySnapshot, balances, now, prices, now);

  // Mirrors the screenshot: the wallet query and ETH quote are ready, while
  // the expanded asset snapshot contains rows but cannot produce a complete
  // portfolio valuation yet.
  assert.equal(walletAssetValuation(displaySnapshot).totalUsd, null);
  assert.equal(walletAssetValuation(displaySnapshot).complete, false);
  assert.equal(displaySnapshot.assets.find((asset) => asset.canonicalKey === 'ETH')?.balance, '0.0006');
  assert.deepEqual(result, { totalUsd: 1.2, assetCount: 2, hasKnownValue: true });
});

test('does not double count an expanded canonical row or use stale fallback data', () => {
  const expanded = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1bc16d674ec80000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now).toISOString() }] },
  ] } }, wallet, now);
  const result = knownFreshPortfolioSubtotal(expanded, {
    balances: [{ key: 'ETH', address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 9n * 10n ** 18n }],
    failedTokens: [],
  }, now, {
    prices: { ETH: 2_000 }, status: 'ready', updatedAt: now, updatedAts: { ETH: now },
  }, now);

  assert.deepEqual(result, { totalUsd: 18_000, assetCount: 1, hasKnownValue: true });
  assert.deepEqual(knownFreshPortfolioSubtotal(expanded, {
    balances: [{ key: 'ETH', address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 2n * 10n ** 18n }],
    failedTokens: [],
  }, now - 3 * 60_000, {
    prices: { ETH: 2_000 }, status: 'ready', updatedAt: now, updatedAts: { ETH: now },
  }, now), { totalUsd: 4_000, assetCount: 1, hasKnownValue: true });
});

test('a fresh exact zero replaces an older positive asset and shows a known zero subtotal', () => {
  const expanded = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1bc16d674ec80000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '2000', lastUpdatedAt: new Date(now - 5_000).toISOString() }] },
  ] } }, wallet, now - 5_000);
  expanded.networks[8453] = { chainId: 8453, status: 'pending', error: 'Base assets are still being verified.' };
  const balances = { balances: [{ key: 'ETH' as const, address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 0n }], failedTokens: [] };
  const prices = { prices: {}, status: 'unavailable' as const, updatedAt: null };
  const displaySnapshot = mergeFreshCanonicalWalletBalances(expanded, balances, now, prices, now);
  const subtotal = knownFreshPortfolioSubtotal(displaySnapshot, balances, now, prices, now);

  assert.equal(displaySnapshot.assets.some((asset) => asset.canonicalKey === 'ETH'), false);
  assert.deepEqual(subtotal, { totalUsd: 0, assetCount: 0, hasKnownValue: true });
  assert.equal(walletAssetValuation(displaySnapshot).totalUsd, null);
  assert.equal(walletAssetValuation(displaySnapshot).complete, false);
});

test('renders canonical ETH rows while expanded discovery is still pending', () => {
  const balances = {
    balances: [{ key: 'ETH' as const, address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 600_000_000_000_000n }],
    failedTokens: [],
  };
  const prices = { prices: { ETH: 2_000 }, status: 'ready' as const, updatedAt: now, updatedAts: { ETH: now } };
  const fallback = canonicalWalletBalancesSnapshot(wallet, balances, now, prices, 'pending', now);
  assert.ok(fallback);
  assert.equal(fallback.assets.find((asset) => asset.canonicalKey === 'ETH')?.balance, '0.0006');
  assert.equal(fallback.networks[1].status, 'ready');
  assert.equal(fallback.networks[8453].status, 'pending');
  assert.equal(walletAssetValuation(fallback).complete, false);
  assert.deepEqual(knownFreshPortfolioSubtotal(fallback, balances, now, prices, now), {
    totalUsd: 1.2, assetCount: 1, hasKnownValue: true,
  });
});

test('an older exact zero does not erase a newer unpriced positive snapshot row', () => {
  const expanded = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0xde0b6b3a7640000', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [] },
  ] } }, wallet, now);
  const balances = { balances: [{ key: 'ETH' as const, address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 0n }], failedTokens: [] };
  const displaySnapshot = mergeFreshCanonicalWalletBalances(expanded, balances, now - 1_000, {
    prices: {}, status: 'unavailable', updatedAt: null,
  }, now);
  const subtotal = knownFreshPortfolioSubtotal(displaySnapshot, balances, now - 1_000, {
    prices: {}, status: 'unavailable', updatedAt: null,
  }, now);

  assert.equal(displaySnapshot.assets.find((asset) => asset.canonicalKey === 'ETH')?.balance, '1');
  assert.deepEqual(subtotal, { totalUsd: null, assetCount: 1, hasKnownValue: false });
});

test('keeps the subtotal unavailable when no verified fresh quote or balance exists', () => {
  assert.deepEqual(knownFreshPortfolioSubtotal(null, {
    balances: [{ key: 'ETH', address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 600_000_000_000_000n }],
    failedTokens: [],
  }, now, { prices: { ETH: 2_000 }, status: 'stale', updatedAt: now - 10 * 60_000 }, now), {
    totalUsd: null, assetCount: 1, hasKnownValue: false,
  });
  assert.deepEqual(knownFreshPortfolioSubtotal(null, {
    balances: [{ key: 'ETH', address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 0n }],
    failedTokens: [],
  }, now, { prices: { ETH: 2_000 }, status: 'ready', updatedAt: now, updatedAts: { ETH: now } }, now), {
    totalUsd: 0, assetCount: 0, hasKnownValue: true,
  });
  const invalidSnapshot = parseAlchemyWalletAssets({ data: { tokens: [
    { address: wallet, network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0x1', tokenMetadata: { symbol: 'ETH', decimals: 18 }, tokenPrices: [{ currency: 'usd', value: '1', lastUpdatedAt: new Date(now).toISOString() }] },
  ] } }, wallet, now);
  invalidSnapshot.assets[0].usdValue = Number.NaN;
  assert.deepEqual(knownFreshPortfolioSubtotal(invalidSnapshot, null, null,
    { prices: {}, status: 'ready', updatedAt: now }, now), { totalUsd: null, assetCount: 1, hasKnownValue: false });
  assert.deepEqual(knownFreshPortfolioSubtotal(null, {
    balances: [{ key: 'ETH', address: FX_TOKENS.ETH.address, decimals: 18, amountWei: 1n }], failedTokens: [],
  }, now, { prices: { ETH: 0 }, status: 'ready', updatedAt: now, updatedAts: { ETH: now } }, now), {
    totalUsd: null, assetCount: 1, hasKnownValue: false,
  });
});
