import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debtShare, leverageAtShare, leverageDebtLabel, leverageForShare, splitPercents, splitTicks, stepLeverage, wholeLeverageTicks } from '../src/lib/leverageShare';

const BOUNDS = { long: { min: 1.1, max: 6.1 }, short: { min: 0.1, max: 6 } } as const;
const tenthsBetween = (min: number, max: number) => Array.from({ length: Math.round((max - min) * 10) + 1 }, (_, index) => Number((min + index / 10).toFixed(1)));

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

test('a debt share reads back as the leverage that drew it', () => {
  for (const side of ['long', 'short'] as const) {
    for (const leverage of [0.1, 0.5, 1.1, 2, 2.8, 3, 4.5, 6.1, 12]) {
      if (side === 'long' && leverage < 1) continue;
      assert.ok(Math.abs(leverageForShare(side, debtShare(side, leverage)) - leverage) < 1e-9, `${side} ${leverage}×`);
    }
  }
  // No debt is 1× for a long and 0× for a short; all debt is unbounded leverage.
  assert.equal(leverageForShare('long', 0), 1);
  assert.equal(leverageForShare('short', 0), 0);
  assert.equal(leverageForShare('long', 1), Number.POSITIVE_INFINITY);
  assert.equal(leverageForShare('short', 1.2), Number.POSITIVE_INFINITY);
  assert.equal(leverageForShare('long', Number.NaN), 1);
});

test('the slider picks the 0.1× step drawn nearest the pointer, never outside the live range', () => {
  for (const side of ['long', 'short'] as const) {
    const { min, max } = BOUNDS[side];
    const steps = tenthsBetween(min, max);
    // Every selectable step is reachable exactly where the track draws it.
    for (const leverage of steps) assert.equal(leverageAtShare(side, debtShare(side, leverage), min, max), leverage, `${side} ${leverage}×`);
    // Between two steps the nearer drawn boundary wins, measured in share, not in ×.
    for (let index = 1; index < steps.length; index += 1) {
      const [low, high] = [steps[index - 1], steps[index]];
      const [lowShare, highShare] = [debtShare(side, low), debtShare(side, high)];
      assert.equal(leverageAtShare(side, lowShare + (highShare - lowShare) * 0.4, min, max), low);
      assert.equal(leverageAtShare(side, lowShare + (highShare - lowShare) * 0.6, min, max), high);
    }
    // The hatched ends of the track clamp to the bounds.
    for (const share of [-1, 0, 0.01, debtShare(side, min) / 2]) assert.equal(leverageAtShare(side, share, min, max), min);
    for (const share of [debtShare(side, max) + 0.01, 0.99, 1, 2, Number.POSITIVE_INFINITY]) assert.equal(leverageAtShare(side, share, min, max), max);
    // Values are clean tenths, so the field and the review read "2.8×", never "2.8000000000000003×".
    for (let share = 0; share <= 1; share += 0.0125) {
      const leverage = leverageAtShare(side, share, min, max);
      assert.equal(leverage, Number(leverage.toFixed(1)));
    }
  }
});

test('keys move the slider by 0.1× and pages by 1×, on the step grid and inside the bounds', () => {
  const { min, max } = BOUNDS.long;
  assert.equal(stepLeverage(2, 0.1, min, max), 2.1);
  assert.equal(stepLeverage(2, -0.1, min, max), 1.9);
  assert.equal(stepLeverage(2.8, 1, min, max), 3.8);
  assert.equal(stepLeverage(2.8, -1, min, max), 1.8);
  assert.equal(stepLeverage(5.5, 1, min, max), max);
  assert.equal(stepLeverage(1.5, -1, min, max), min);
  // A typed value off the grid or outside the range starts from where the slider shows it.
  assert.equal(stepLeverage(2.86, 0.1, min, max), 3);
  assert.equal(stepLeverage(9, -1, min, max), 5.1);
  assert.equal(stepLeverage(0, 1, min, max), 2.1);
  assert.equal(stepLeverage(Number.NaN, 0.1, min, max), 1.2);
  assert.equal(stepLeverage(0.1, 1, 0.1, 6), 1.1);
});

test('ticks mark the whole leverages inside the live range, where each extra × moves the boundary less', () => {
  assert.deepEqual(wholeLeverageTicks(1.1, 6.1), [2, 3, 4, 5, 6]);
  assert.deepEqual(wholeLeverageTicks(0.1, 6), [1, 2, 3, 4, 5]);
  assert.deepEqual(wholeLeverageTicks(2, 3), []);
  assert.deepEqual(wholeLeverageTicks(Number.NaN, 6), []);
  const gaps = wholeLeverageTicks(1.1, 6.1).map((leverage) => debtShare('long', leverage)).map((share, index, all) => index ? share - all[index - 1] : share);
  for (let index = 2; index < gaps.length; index += 1) assert.ok(gaps[index] < gaps[index - 1]);
});

test('ticks sit at each whole leverage’s debt share and stop before they crowd or touch the range end', () => {
  const leverages = (side: 'long' | 'short', min: number, max: number) => splitTicks(side, min, max).map((tick) => tick.leverage);
  // Today's pool ranges: every whole × is drawn, except 6× at a 6.1× end (under a pixel apart).
  assert.deepEqual(leverages('long', 1.1, 6.1), [2, 3, 4, 5]);
  assert.deepEqual(leverages('short', 0.1, 6), [1, 2, 3, 4, 5]);
  // A much wider range stops where the next tick would sit within 2.5% of the track.
  assert.deepEqual(leverages('long', 1.2, 14.5), [2, 3, 4, 5, 6]);
  for (const side of ['long', 'short'] as const) {
    for (const tick of splitTicks(side, 0.1, 30)) assert.equal(tick.share, debtShare(side, tick.leverage));
  }
});
