/**
 * Tests for newly added UI features and arithmetic helpers.
 * Runs under Node's native test runner (node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Helper arithmetic functions tested directly
function positiveDecimal(value, maxDecimals) {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  if (!value || value.length > 100) return null;
  const pattern = maxDecimals === 0
    ? /^\d+$/
    : new RegExp(`^(?:\\d+(?:\\.\\d{1,${maxDecimals}})?|\\.\\d{1,${maxDecimals}})$`);
  if (!pattern.test(value)) return null;
  return /[1-9]/.test(value) ? value : null;
}

function decimalToUnits(value, decimals) {
  const valid = positiveDecimal(value, decimals);
  if (!valid) return null;
  const [integerRaw, fractionRaw = ''] = valid.split('.');
  const integer = integerRaw || '0';
  const fraction = fractionRaw.padEnd(decimals, '0');
  try {
    return BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction || '0');
  } catch {
    return null;
  }
}

function calculateFractionDecimal(balance, percent, maxDecimals = 18) {
  if (!balance || !Number.isFinite(percent) || percent <= 0) return '';
  const cleanBalance = balance.trim();
  const valid = positiveDecimal(cleanBalance, maxDecimals);
  if (!valid) return '';

  if (percent >= 100) return valid;

  const units = decimalToUnits(valid, maxDecimals);
  if (units === null) return '';

  const fractionUnits = (units * BigInt(Math.round(percent))) / 100n;
  if (fractionUnits === 0n) return '0';

  const padded = fractionUnits.toString().padStart(maxDecimals + 1, '0');
  const integer = padded.slice(0, -maxDecimals) || '0';
  const fraction = padded.slice(-maxDecimals).replace(/0+$/, '');

  return fraction ? `${integer}.${fraction}` : integer;
}

function getRiskTier(value, mode) {
  if (mode === 'leverage') {
    const leverage = value;
    const bufferPct = leverage > 0 ? (1 / leverage) * 100 : 100;
    if (leverage <= 2) return { tier: 'safe', label: 'Low Risk', bufferPct };
    if (leverage <= 3.5) return { tier: 'moderate', label: 'Moderate', bufferPct };
    if (leverage <= 6) return { tier: 'high', label: 'High Risk', bufferPct };
    return { tier: 'critical', label: 'Critical / Extreme', bufferPct };
  }
  const health = Math.max(0, Math.min(1, value));
  const bufferPct = health * 100;
  if (health >= 0.65) return { tier: 'safe', label: 'Healthy', bufferPct };
  if (health >= 0.4) return { tier: 'moderate', label: 'Moderate', bufferPct };
  if (health >= 0.2) return { tier: 'high', label: 'Caution', bufferPct };
  return { tier: 'critical', label: 'Liquidation Risk', bufferPct };
}

test('calculateFractionDecimal calculates exact percentages without float errors', () => {
  // 100 ETH at 50% = 50
  assert.equal(calculateFractionDecimal('100', 50, 18), '50');

  // 1 ETH at 25% = 0.25
  assert.equal(calculateFractionDecimal('1', 25, 18), '0.25');

  // 1.5 ETH at 50% = 0.75
  assert.equal(calculateFractionDecimal('1.5', 50, 18), '0.75');

  // 100.00 at 75% = 75
  assert.equal(calculateFractionDecimal('100.00', 75, 2), '75');

  // 100% returns original valid balance
  assert.equal(calculateFractionDecimal('4.5678', 100, 4), '4.5678');

  // Edge cases: empty or invalid balance
  assert.equal(calculateFractionDecimal('', 50, 18), '');
  assert.equal(calculateFractionDecimal('abc', 50, 18), '');
  assert.equal(calculateFractionDecimal(null, 50, 18), '');
  assert.equal(calculateFractionDecimal('0', 50, 18), '');
});

test('getRiskTier maps leverage and health ratios to correct risk categories', () => {
  // Safe leverage (<= 2x)
  assert.equal(getRiskTier(1.5, 'leverage').tier, 'safe');
  assert.equal(getRiskTier(2.0, 'leverage').tier, 'safe');

  // Moderate leverage (2x - 3.5x)
  assert.equal(getRiskTier(3.0, 'leverage').tier, 'moderate');

  // High leverage (3.5x - 6x)
  assert.equal(getRiskTier(5.0, 'leverage').tier, 'high');

  // Critical leverage (> 6x)
  assert.equal(getRiskTier(10.0, 'leverage').tier, 'critical');

  // Health ratios
  assert.equal(getRiskTier(0.85, 'health').tier, 'safe');
  assert.equal(getRiskTier(0.50, 'health').tier, 'moderate');
  assert.equal(getRiskTier(0.30, 'health').tier, 'high');
  assert.equal(getRiskTier(0.10, 'health').tier, 'critical');
});
