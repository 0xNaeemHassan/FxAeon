import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateFractionDecimal, decimalInputError, decimalToUnits, formatBalanceDecimal, formatExactDecimal, formatSignificantDecimal, formatSignificantDecimalUp, groupDigits, normalizeAmountInput } from '../src/lib/amount';

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
  assert.equal(formatExactDecimal('9007199254740993.123456789012345678', 6), '9,007,199,254,740,993.123457');
});

test('amount errors name the problem and the fix', () => {
  assert.equal(decimalInputError('2.1234567890123456789', 18), 'This asset allows 18 decimal places. Remove the extra digits.');
  assert.equal(decimalInputError('1.0000001', 6), 'This asset allows 6 decimal places. Remove the extra digits.');
  assert.equal(decimalInputError('1.5', 0), 'This asset has no decimal places. Enter a whole number.');
  for (const malformed of ['2.1e3', '1,5', '-1', 'abc', '1.2.3']) assert.equal(decimalInputError(malformed, 18), 'Use digits and one decimal point, like 1.25.');
  assert.equal(decimalInputError('1.', 18), 'Add a digit after the decimal point.');
  assert.equal(decimalInputError('0', 18), 'Enter an amount greater than zero.');
  assert.equal(decimalInputError('0', 18, { allowZero: true }), null);
  assert.equal(decimalInputError('all', 18, { allowAll: true }), null);
});

test('spendable balances round down, group, and never read as zero', () => {
  // Rounded half-up, 0.123456789 would read 0.12345679: more than the wallet holds.
  assert.equal(formatBalanceDecimal('0.123456789'), '0.12345678');
  assert.equal(formatBalanceDecimal('1.999999999999999999'), '1.99999999');
  assert.equal(formatBalanceDecimal('1234567.5'), '1,234,567.5');
  assert.equal(formatBalanceDecimal('1.25'), '1.25');
  assert.equal(formatBalanceDecimal('1.000000000'), '1');
  assert.equal(formatBalanceDecimal('0'), '0');
  assert.equal(formatBalanceDecimal('0.000'), '0');
  assert.equal(formatBalanceDecimal('007.5'), '7.5');
  // Dust below the last place is named, not shown as zero.
  assert.equal(formatBalanceDecimal('0.000000001'), '<0.00000001');
  assert.equal(formatBalanceDecimal('0.00001', 4), '<0.0001');
  assert.equal(formatBalanceDecimal('1.00001', 4), '1');
  assert.equal(formatBalanceDecimal('0.5', 0), '<1');
  assert.equal(formatBalanceDecimal('12.98765', 4), '12.9876');
  for (const untouched of ['-1', '1e21', '', 'abc', '1,000']) assert.equal(formatBalanceDecimal(untouched), untouched);
});

test('costs and minimums round up so the figure shown always covers the exact one', () => {
  assert.equal(formatSignificantDecimalUp('0.000825123456789'), '0.000826');
  assert.equal(formatSignificantDecimalUp('0.000825'), '0.000825');
  assert.equal(formatSignificantDecimalUp('0.0009995'), '0.001');
  assert.equal(formatSignificantDecimalUp('9.9995'), '10');
  assert.equal(formatSignificantDecimalUp('999.95'), '1,000');
  assert.equal(formatSignificantDecimalUp('1234.561', 4), '1,234.57');
  assert.equal(formatSignificantDecimalUp('12.3401', 4), '12.35');
  assert.equal(formatSignificantDecimalUp('2'), '2');
  assert.equal(formatSignificantDecimalUp('0'), '0');
  assert.equal(formatSignificantDecimalUp('0.000000000000000001'), '0.000000000000000001');
  for (const untouched of ['-1', '1e21', '', 'abc']) assert.equal(formatSignificantDecimalUp(untouched), untouched);
  // Never below the exact value, and never more than one step above it.
  for (const value of ['0.1234567', '45.678901', '7.0000001', '0.00000123456', '98765.4321']) {
    const shown = formatSignificantDecimalUp(value, 4).replace(/,/g, '');
    assert.ok(Number(shown) >= Number(value), `${shown} covers ${value}`);
    assert.ok(Number(shown) - Number(value) < Number(value) * 1e-3 + 0.01, `${shown} stays close to ${value}`);
  }
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
