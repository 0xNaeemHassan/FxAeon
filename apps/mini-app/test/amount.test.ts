import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateFractionDecimal, decimalInputError, decimalToUnits, formatExactDecimal } from '../src/lib/amount';

test('percentage sizing calculates exact token units without floating point drift', () => {
  const balance = '9007199254740993.123456789012345678';
  assert.equal(calculateFractionDecimal(balance, 25, 18), '2251799813685248.280864197253086419');
  assert.equal(calculateFractionDecimal(balance, 50, 18), '4503599627370496.561728394506172839');
  assert.equal(calculateFractionDecimal(balance, 75, 18), '6755399441055744.842592591759259258');
  assert.equal(calculateFractionDecimal(balance, 100, 18), balance);
});

test('decimal controls preserve 2.1 drafts and reject excess precision', () => {
  assert.equal(decimalToUnits('2.1', 18), 2100000000000000000n);
  assert.equal(decimalInputError('2.1', 18), null);
  assert.equal(decimalInputError('2.1234567890123456789', 18), '18-decimal precision maximum for this asset.');
  assert.equal(decimalInputError('2.1e3', 18), 'Enter a plain decimal number.');
  assert.equal(formatExactDecimal('9007199254740993.123456789012345678', 6), '9,007,199,254,740,993.123457');
});
