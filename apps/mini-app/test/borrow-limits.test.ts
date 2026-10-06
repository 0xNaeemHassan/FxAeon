import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borrowCapacity, borrowDebtBounds, loanToValueBps, withdrawableCollateralUsdCents } from '../src/lib/fx/borrowLimits';
import { fallbackDebtRatioRange } from '../src/lib/fx/leverage';

const ETH_LONG = fallbackDebtRatioRange('ETH', 'long'); // 2.56% .. 85.5%
const fxUSD = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
};

test('the reported case: 1 fxUSD against $0.88 of ETH is over the limit', () => {
  const { maxAdditional, minAdditional } = borrowCapacity({ collateralUsdCents: 88n, existingDebt: 0n, range: ETH_LONG });
  // 0.88 × 85.5% × 98% ≈ 0.7373 fxUSD
  assert.ok(maxAdditional < fxUSD('1'));
  assert.ok(maxAdditional > fxUSD('0.737') && maxAdditional < fxUSD('0.738'));
  // 0.88 × 2.56% × 102% ≈ 0.02298 fxUSD
  assert.ok(minAdditional > fxUSD('0.0229') && minAdditional < fxUSD('0.0230'));
});

test('limits scale with collateral and leave room for the SDK window', () => {
  const { maxDebt, minDebt } = borrowDebtBounds(1_000_000n, ETH_LONG); // $10,000
  assert.equal(maxDebt, fxUSD('8379')); // 10,000 × 0.855 × 0.98
  assert.equal(minDebt, fxUSD('261.12')); // 10,000 × 0.0256 × 1.02
  assert.deepEqual(borrowDebtBounds(0n, ETH_LONG), { minDebt: 0n, maxDebt: 0n });
});

test('existing debt uses up capacity, never below zero', () => {
  const full = borrowCapacity({ collateralUsdCents: 1_000_000n, existingDebt: fxUSD('8379'), range: ETH_LONG });
  assert.equal(full.maxAdditional, 0n);
  assert.equal(full.minAdditional, 0n);
  const over = borrowCapacity({ collateralUsdCents: 1_000_000n, existingDebt: fxUSD('9000'), range: ETH_LONG });
  assert.equal(over.maxAdditional, 0n);
  const partial = borrowCapacity({ collateralUsdCents: 1_000_000n, existingDebt: fxUSD('5000'), range: ETH_LONG });
  assert.equal(partial.maxAdditional, fxUSD('3379'));
});

test('withdrawals keep the remaining debt inside the range', () => {
  // $10,000 collateral, 5,000 fxUSD debt: needs 5,000 / (0.855 × 0.98) ≈ $5,967.3 of collateral.
  const withdrawable = withdrawableCollateralUsdCents(1_000_000n, fxUSD('5000'), ETH_LONG);
  assert.ok(withdrawable > 403_200n && withdrawable < 403_300n);
  assert.equal(withdrawableCollateralUsdCents(1_000_000n, 0n, ETH_LONG), 1_000_000n);
  assert.equal(withdrawableCollateralUsdCents(1_000_000n, fxUSD('9000'), ETH_LONG), 0n);
});

test('loan-to-value is reported in basis points', () => {
  assert.equal(loanToValueBps(fxUSD('5000'), 1_000_000n), 5000n);
  assert.equal(loanToValueBps(fxUSD('1'), 88n), 11363n);
  assert.equal(loanToValueBps(fxUSD('1'), 0n), null);
});
