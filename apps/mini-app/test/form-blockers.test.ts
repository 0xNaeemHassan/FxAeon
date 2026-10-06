import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountBlocker } from '../src/lib/formBlockers';

const ready = (amount: string) => ({ status: 'ready', amount });

test('an amount names what it still needs, in order', () => {
  assert.equal(amountBlocker('', 18, 'ETH', ready('0.5')), 'Enter an amount');
  assert.equal(amountBlocker('  ', 18, 'ETH', ready('0.5')), 'Enter an amount');
  assert.equal(amountBlocker('1.2.3', 18, 'ETH', ready('0.5')), 'Enter a valid amount');
  assert.equal(amountBlocker('0', 18, 'ETH', ready('0.5')), 'Enter a valid amount');
  assert.equal(amountBlocker('0.0000001', 6, 'USDC', ready('5')), 'Enter a valid amount');
  assert.equal(amountBlocker('0.6', 18, 'ETH', ready('0.5')), 'Insufficient ETH');
  assert.equal(amountBlocker('0.5', 18, 'ETH', ready('0.5')), null);
  assert.equal(amountBlocker('0.25', 18, 'ETH', ready('0.5')), null);
});

test('an empty wallet is named before anything is typed', () => {
  assert.equal(amountBlocker('', 18, 'fxUSD', ready('0')), 'No fxUSD available');
  assert.equal(amountBlocker('1', 18, 'fxUSD', ready('0.0'), { emptyLabel: 'No fxUSD on Ethereum' }), 'No fxUSD on Ethereum');
});

test('an unsettled balance never blocks, and exact comparison avoids floats', () => {
  assert.equal(amountBlocker('5', 18, 'ETH', { status: 'loading' }), null);
  assert.equal(amountBlocker('5', 18, 'ETH', { status: 'unavailable' }), null);
  assert.equal(amountBlocker('5', 18, 'ETH', undefined), null);
  // 0.1 + 0.2 style drift cannot make an exact balance look short.
  assert.equal(amountBlocker('0.3', 18, 'ETH', ready('0.300000000000000000')), null);
  assert.equal(amountBlocker('0.300000000000000001', 18, 'ETH', ready('0.3')), 'Insufficient ETH');
  assert.equal(amountBlocker('9007199254740993', 18, 'fxUSD', ready('9007199254740992.999999999999999999')), 'Insufficient fxUSD');
});

test('"all" passes only where a form accepts it', () => {
  assert.equal(amountBlocker('all', 18, 'fxSAVE', ready('3'), { allowAll: true }), null);
  assert.equal(amountBlocker('all', 18, 'fxSAVE', ready('3')), 'Enter a valid amount');
});
