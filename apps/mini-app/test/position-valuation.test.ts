import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePositionUsdValuation, formatUsdCents } from '../src/lib/positionValuation';

const WAD = 10n ** 18n;

test('position valuation preserves bigint accounting precision and rounds to cents', () => {
  const valuation = calculatePositionUsdValuation({
    collateralRaw: 2n * WAD,
    collateralDecimals: 18,
    collateralPrice: 2000.25,
    debtRaw: 500n * WAD,
    debtDecimals: 18,
    debtPrice: 1,
  });

  assert.equal(valuation.collateralUsdCents, 400050n);
  assert.equal(valuation.debtUsdCents, 50000n);
  assert.equal(valuation.netEquityUsdCents, 350050n);
  assert.equal(formatUsdCents(valuation.netEquityUsdCents), '$3,500.50');
});

test('large raw positions do not pass bigint amounts through Number arithmetic', () => {
  const valuation = calculatePositionUsdValuation({
    collateralRaw: 10n ** 80n,
    collateralDecimals: 18,
    collateralPrice: 1.25,
    debtRaw: 0n,
    debtDecimals: 18,
    debtPrice: 1,
  });

  assert.equal(valuation.netEquityUsdCents, 125n * 10n ** 62n);
  assert.match(formatUsdCents(valuation.netEquityUsdCents), /^\$125,000/);
});

test('missing or invalid validated prices make net equity unavailable', () => {
  const valuation = calculatePositionUsdValuation({
    collateralRaw: WAD,
    collateralDecimals: 18,
    collateralPrice: undefined,
    debtRaw: WAD,
    debtDecimals: 18,
    debtPrice: 1,
  });

  assert.equal(valuation.collateralUsdCents, null);
  assert.equal(valuation.debtUsdCents, 100n);
  assert.equal(valuation.netEquityUsdCents, null);
  assert.equal(formatUsdCents(null), '—');
});

test('net equity rounds once after subtracting high-precision legs', () => {
  const valuation = calculatePositionUsdValuation({
    collateralRaw: WAD,
    collateralDecimals: 18,
    collateralPrice: 0.0055,
    debtRaw: WAD,
    debtDecimals: 18,
    debtPrice: 0.0046,
  });

  // The displayed legs round to one and zero cents, but their exact net is
  // 0.09 cents and must still round to zero rather than inherit that drift.
  assert.equal(valuation.collateralUsdCents, 1n);
  assert.equal(valuation.debtUsdCents, 0n);
  assert.equal(valuation.netEquityUsdCents, 0n);
});

test('zero raw legs remain exactly zero when their price is unavailable', () => {
  const valuation = calculatePositionUsdValuation({
    collateralRaw: 0n,
    collateralDecimals: 18,
    collateralPrice: undefined,
    debtRaw: WAD,
    debtDecimals: 18,
    debtPrice: 1,
  });

  assert.equal(valuation.collateralUsdCents, 0n);
  assert.equal(valuation.debtUsdCents, 100n);
  assert.equal(valuation.netEquityUsdCents, -100n);

  const zeroDebt = calculatePositionUsdValuation({
    collateralRaw: WAD,
    collateralDecimals: 18,
    collateralPrice: 1,
    debtRaw: 0n,
    debtDecimals: 18,
    debtPrice: undefined,
  });
  assert.equal(zeroDebt.collateralUsdCents, 100n);
  assert.equal(zeroDebt.debtUsdCents, 0n);
  assert.equal(zeroDebt.netEquityUsdCents, 100n);
});
