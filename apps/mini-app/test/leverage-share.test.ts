import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debtShare, leverageDebtLabel, splitPercents } from '../src/lib/leverageShare';

test('a long is debt over collateral, (L − 1) / L', () => {
  assert.equal(debtShare('long', 1), 0);
  assert.equal(debtShare('long', 2), 1 / 2);
  assert.equal(debtShare('long', 3), 2 / 3);
  assert.equal(debtShare('long', 4), 3 / 4);
});

test('a short is borrowed exposure over collateral, L / (L + 1)', () => {
  assert.equal(debtShare('short', 1), 1 / 2);
  assert.equal(debtShare('short', 2), 2 / 3);
  assert.equal(debtShare('short', 3), 3 / 4);
});

test('leverage that cannot describe a position has no debt share', () => {
  for (const leverage of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(debtShare('long', leverage), 0);
    assert.equal(debtShare('short', leverage), 0);
  }
  // A long below 1× would be negative debt; it reads as none.
  assert.equal(debtShare('long', 0.5), 0);
});

test('the two shares are whole percentages that always total 100', () => {
  for (const side of ['long', 'short'] as const) {
    for (let tenths = 1; tenths <= 200; tenths++) {
      const { debt, yours } = splitPercents(side, tenths / 10);
      assert.ok(Number.isInteger(debt) && Number.isInteger(yours));
      assert.equal(debt + yours, 100, `${side} ${tenths / 10}×`);
      assert.ok(debt >= 0 && yours >= 0);
    }
  }
  assert.deepEqual(splitPercents('long', 3), { debt: 67, yours: 33 });
  assert.deepEqual(splitPercents('short', 3), { debt: 75, yours: 25 });
  assert.deepEqual(splitPercents('long', 1.1), { debt: 9, yours: 91 });
});

test('the debt is named by direction and market', () => {
  assert.equal(leverageDebtLabel('long', 'ETH'), 'minted fxUSD');
  assert.equal(leverageDebtLabel('long', 'BTC'), 'minted fxUSD');
  assert.equal(leverageDebtLabel('short', 'ETH'), 'borrowed wstETH');
  assert.equal(leverageDebtLabel('short', 'BTC'), 'borrowed WBTC');
});
