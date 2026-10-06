import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateFractionDecimal, decimalInputError, decimalToUnits, formatExactDecimal, formatSignificantDecimal, groupDigits, normalizeAmountInput } from '../src/lib/amount';

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

test('amount input normalization follows an explicit separator policy', () => {
  assert.equal(normalizeAmountInput('1.25'), '1.25');
  assert.equal(normalizeAmountInput('1,000'), null);
  assert.equal(normalizeAmountInput('1,25', 'comma-decimal'), '1.25');
  assert.equal(normalizeAmountInput('1,000', 'comma-decimal'), null);
  assert.equal(normalizeAmountInput('1.000,25', 'comma-decimal'), null);
});

test('digit grouping adds separators to the whole part only and never alters the value', () => {
  assert.equal(groupDigits('1234567.000001'), '1,234,567.000001');
  assert.equal(groupDigits('999.5'), '999.5');
  assert.equal(groupDigits('1000'), '1,000');
  assert.equal(groupDigits('0.000001'), '0.000001');
  for (const untouched of ['-1500', '1,500', '1e21', '', '12.']) assert.equal(groupDigits(untouched), untouched);
  assert.equal(groupDigits('9007199254740993.123456789012345678').replace(/,/g, ''), '9007199254740993.123456789012345678');
});

test('display amounts keep significant digits, truncate toward zero, and name dust', () => {
  // Values from a real wallet's History and Send screens.
  assert.equal(formatSignificantDecimal('0.000645137318848811'), '0.00064513');
  assert.equal(formatSignificantDecimal('0.01468667497527329'), '0.014686');
  assert.equal(formatSignificantDecimal('0.3472804925029102'), '0.34728');
  assert.equal(formatSignificantDecimal('0.3472804925029102', 4), '0.3472');
  assert.equal(formatSignificantDecimal('0.0011331155648316', 4), '0.001133');
  // Whole numbers survive; two decimals once amounts reach 1,000.
  assert.equal(formatSignificantDecimal('1.23456789'), '1.2345');
  assert.equal(formatSignificantDecimal('2713.3149'), '2,713.31');
  assert.equal(formatSignificantDecimal('104000.129'), '104,000.12');
  assert.equal(formatSignificantDecimal('9007199254740993.123456789'), '9,007,199,254,740,993.12');
  // Trailing zeros never pad the copy.
  assert.equal(formatSignificantDecimal('2.000'), '2');
  assert.equal(formatSignificantDecimal('0.50'), '0.5');
  assert.equal(formatSignificantDecimal('0'), '0');
  assert.equal(formatSignificantDecimal('0.000'), '0');
  // Dust: exactly one millionth still prints; anything smaller does not.
  assert.equal(formatSignificantDecimal('0.000001'), '0.000001');
  assert.equal(formatSignificantDecimal('0.0000015'), '0.0000015');
  assert.equal(formatSignificantDecimal('0.00000099'), '<0.000001');
  // Signs pass through; unparseable input is returned untouched.
  assert.equal(formatSignificantDecimal('-0.02325'), '-0.02325');
  for (const untouched of ['1e21', '', 'abc', '1,000']) assert.equal(formatSignificantDecimal(untouched), untouched);
});
