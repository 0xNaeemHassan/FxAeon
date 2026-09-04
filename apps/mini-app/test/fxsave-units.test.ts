import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FX_SAVE_UNITS, fxSaveUsdValue, normalizedFxSaveAssetsWei } from '../src/lib/fxSaveUnits';

const prices = { fxUSD: 1, fxUSDBasePool: 1.25, fxSAVE: 1.75 };
const fourTokens = 4_000_000_000_000_000_000n;

test('SDK assets and queued redemption fields are base-pool shares, not fxUSD or fxSAVE', () => {
  for (const field of ['assetsWei', 'totalAssetsWei', 'pendingSharesWei'] as const) {
    assert.equal(FX_SAVE_UNITS[field].priceKey, 'fxUSDBasePool');
    assert.equal(FX_SAVE_UNITS[field].label, 'fxUSD pool token');
    assert.equal(fxSaveUsdValue(field, fourTokens, prices), 5);
  }
});

test('wallet balance and vault supply remain denominated in fxSAVE shares', () => {
  for (const field of ['balanceWei', 'totalSupplyWei'] as const) {
    assert.equal(FX_SAVE_UNITS[field].priceKey, 'fxSAVE');
    assert.equal(FX_SAVE_UNITS[field].label, 'fxSAVE');
    assert.equal(fxSaveUsdValue(field, fourTokens, prices), 7);
  }
});

test('exact formatted asset decimals use the same base-pool price as raw SDK units', () => {
  assert.equal(fxSaveUsdValue('assetsWei', '4', prices), 5);
  assert.equal(fxSaveUsdValue('assetsWei', '4', prices), fxSaveUsdValue('assetsWei', fourTokens, prices));
  assert.equal(fxSaveUsdValue('assetsWei', '0.4', prices), 0.5);
});

test('missing base-pool quotes never fall back to fxUSD parity or the fxSAVE token price', () => {
  const unrelated = { fxUSD: 1, fxSAVE: 1.75 };
  assert.equal(fxSaveUsdValue('assetsWei', fourTokens, unrelated), null);
  assert.equal(fxSaveUsdValue('totalAssetsWei', fourTokens, unrelated), null);
  assert.equal(fxSaveUsdValue('pendingSharesWei', fourTokens, unrelated), null);
});

test('unavailable amounts and invalid matching prices cannot produce a USD estimate', () => {
  assert.equal(fxSaveUsdValue('assetsWei', undefined, prices), null);
  assert.equal(fxSaveUsdValue('assetsWei', null, prices), null);
  assert.equal(fxSaveUsdValue('assetsWei', -1n, prices), null);
  assert.equal(fxSaveUsdValue('assetsWei', 'unavailable', prices), null);
  for (const price of [0, -1, Infinity, NaN]) {
    assert.equal(fxSaveUsdValue('assetsWei', fourTokens, { ...prices, fxUSDBasePool: price }), null);
  }
});

test('a successful zero-share SDK balance exposes zero base-pool assets', () => {
  assert.equal(normalizedFxSaveAssetsWei(0n, undefined), 0n);
  assert.equal(normalizedFxSaveAssetsWei(10n, 12n), 12n);
  assert.equal(normalizedFxSaveAssetsWei(10n, undefined), undefined);
});
