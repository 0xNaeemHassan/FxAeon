import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import {
  mergeCanonicalWalletAssets,
  parseAlchemyWalletAssets,
  summarizeWalletAssets,
  type WalletAssetSnapshot,
} from '../src/lib/walletAssets';

const wallet = '0x0000000000000000000000000000000000001234';
const now = Date.parse('2026-09-05T00:00:00.000Z');

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
  assert.equal(summarizeWalletAssets(merged, now).totalUsdValue, 4800);
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
