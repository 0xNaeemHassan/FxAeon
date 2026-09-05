import assert from 'node:assert/strict';
import test from 'node:test';
import { readTradeDeepLinkContext, resetTransactionAmounts, SAFE_DEFAULT_FRACTION, SAFE_DEFAULT_LEVERAGE } from '../src/lib/transactionState';

test('context reset clears every cross-flow transaction amount and restores conservative defaults', () => {
  assert.deepEqual(resetTransactionAmounts(), {
    amount: '',
    deposit: '',
    mint: '',
    repay: '',
    withdraw: '',
    shares: '',
    fraction: SAFE_DEFAULT_FRACTION,
    leverage: SAFE_DEFAULT_LEVERAGE,
  });
});

test('context reset returns a fresh object so one flow cannot mutate another reset', () => {
  const first = resetTransactionAmounts();
  first.amount = '1';
  first.fraction = 90;
  const second = resetTransactionAmounts();
  assert.equal(second.amount, '');
  assert.equal(second.fraction, SAFE_DEFAULT_FRACTION);
  assert.equal(second.leverage, SAFE_DEFAULT_LEVERAGE);
});

test('Trade deep links retain explicit market, side, and asset context', () => {
  assert.deepEqual(readTradeDeepLinkContext('?market=BTC&side=short&asset=WBTC'), {
    market: 'BTC',
    side: 'short',
    asset: 'WBTC',
  });
  assert.equal(readTradeDeepLinkContext('?'), null);
});
