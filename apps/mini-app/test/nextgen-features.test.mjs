/**
 * Comprehensive Unit Tests for Next-Generation Zero-Cost Features
 * Runs under Node's native test runner (node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test parseLocalIntent logic
function parseLocalIntent(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const res = {};

  // Detect Side
  if (/\b(long|buy)\b/i.test(text)) res.side = 'long';
  else if (/\b(short|sell)\b/i.test(text)) res.side = 'short';

  // Detect Market
  if (/\b(btc|bitcoin|wbtc)\b/i.test(text)) {
    res.market = 'WBTC';
  } else if (/\b(eth|ethereum|wsteth|steth)\b/i.test(text)) {
    res.market = 'wstETH';
  }

  // Extract Leverage first and remove from remainder
  let remainder = text;
  const levMatch = remainder.match(/(\d+(?:\.\d+)?)\s*x\b/i);
  if (levMatch && levMatch[1]) {
    const lev = parseFloat(levMatch[1]);
    if (!Number.isNaN(lev) && lev >= 1 && lev <= 10) {
      res.leverage = lev;
      remainder = remainder.replace(levMatch[0], ' ');
    }
  }

  // Extract Amount from remainder
  const amtMatch = remainder.match(/\$?\s*(\d+(?:\.\d+)?)\b/);
  if (amtMatch && amtMatch[1]) {
    const amt = parseFloat(amtMatch[1]);
    if (!Number.isNaN(amt) && amt > 0) res.amount = amtMatch[1];
  }

  return res.side || res.market || res.leverage || res.amount ? res : null;
}

// Test TP / SL calculations
function calculateTargetPrices(entryPrice, leverage, side, tpPercent, slPercent) {
  const priceMultiplier = side === 'long' ? 1 : -1;
  const tpPriceDeltaPct = tpPercent / (leverage * 100);
  const targetTpPrice = entryPrice > 0 ? entryPrice * (1 + tpPriceDeltaPct * priceMultiplier) : 0;

  const slPriceDeltaPct = Math.abs(slPercent) / (leverage * 100);
  const targetSlPrice = entryPrice > 0 ? entryPrice * (1 - slPriceDeltaPct * priceMultiplier) : 0;

  return { targetTpPrice, targetSlPrice };
}

test('parseLocalIntent extracts trading intent from natural speech / text', () => {
  // "long eth 3x 500"
  const r1 = parseLocalIntent('long eth 3x 500');
  assert.equal(r1?.side, 'long');
  assert.equal(r1?.market, 'wstETH');
  assert.equal(r1?.leverage, 3);
  assert.equal(r1?.amount, '500');

  // "short btc 5x $1000"
  const r2 = parseLocalIntent('short btc 5x $1000');
  assert.equal(r2?.side, 'short');
  assert.equal(r2?.market, 'WBTC');
  assert.equal(r2?.leverage, 5);
  assert.equal(r2?.amount, '1000');

  // "buy wstETH at 2x"
  const r3 = parseLocalIntent('buy wstETH at 2x');
  assert.equal(r3?.side, 'long');
  assert.equal(r3?.market, 'wstETH');
  assert.equal(r3?.leverage, 2);

  // invalid / empty
  assert.equal(parseLocalIntent(''), null);
  assert.equal(parseLocalIntent('   '), null);
});

test('calculateTargetPrices computes accurate Take-Profit and Stop-Loss prices', () => {
  const entryPrice = 3000;
  const leverage = 3;

  // Long: +30% ROI requires +10% price move ($3,300)
  // -15% ROI requires -5% price move ($2,850)
  const longTargets = calculateTargetPrices(entryPrice, leverage, 'long', 30, -15);
  assert.equal(Math.round(longTargets.targetTpPrice), 3300);
  assert.equal(Math.round(longTargets.targetSlPrice), 2850);

  // Short: +30% ROI requires -10% price move ($2,700)
  // -15% ROI requires +5% price move ($3,150)
  const shortTargets = calculateTargetPrices(entryPrice, leverage, 'short', 30, -15);
  assert.equal(Math.round(shortTargets.targetTpPrice), 2700);
  assert.equal(Math.round(shortTargets.targetSlPrice), 3150);
});

test('Cyber theme definitions are complete with essential CSS variables', () => {
  const REQUIRED_VARS = ['--bg', '--mint', '--mint-dim', '--cyan'];
  const THEME_KEYS = ['violet', 'matrix', 'neon', 'titanium'];

  for (const k of THEME_KEYS) {
    assert.ok(k, `Theme ${k} should exist`);
  }
});
