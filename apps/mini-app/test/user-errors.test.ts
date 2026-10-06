import assert from 'node:assert/strict';
import test from 'node:test';
import { userSafeError } from '../src/lib/errors';

test('network aborts give an actionable message instead of a browser diagnostic', () => {
  for (const cause of [new DOMException('signal is aborted without reason', 'AbortError'), new DOMException('The operation timed out.', 'TimeoutError'), new Error('signal is aborted without reason')]) {
    assert.equal(userSafeError(cause, 'Failed'), 'The request timed out or was interrupted. Try again.');
  }
});

test('leverage errors explain the required edit without exposing SDK product names', () => {
  for (const product of ['xPOSITION', 'sPOSITION']) {
    assert.equal(userSafeError(new Error(`Your ${product} leverage is higher than the maximum leverage allowed, please lower your leverage level.`), 'Failed'), 'Lower the target leverage for this amount.');
    assert.equal(userSafeError(new Error(`Your ${product} leverage is lower than the minimum leverage required, please increase your leverage level.`), 'Failed'), 'Increase the target leverage for this amount.');
  }
});

test('provider diagnostics remain hidden even when they contain a leverage error', () => {
  assert.equal(userSafeError(new Error('Your xPOSITION leverage is higher than the maximum leverage allowed, please lower your leverage level. https://rpc.example/private'), 'Retry'), 'Retry');
  assert.equal(userSafeError(new Error('Request body: api_key=private'), 'Retry'), 'Retry');
  assert.equal(userSafeError(new Error('Quote expired. Review again.'), 'Retry'), 'Quote expired. Review again.');
});

test('bare provider codes fall back to a sentence instead of reaching the screen', () => {
  for (const code of ['network_error', 'exited_auth_flow', 'ACTION_REJECTED', 'CALL_EXCEPTION']) {
    assert.equal(userSafeError(code, 'Sign-in was not completed.'), 'Sign-in was not completed.');
    assert.equal(userSafeError(new Error(code), 'Retry'), 'Retry');
  }
  assert.equal(userSafeError('Wallet locked', 'Retry'), 'Wallet locked');
  assert.equal(userSafeError(new Error('Insufficient balance'), 'Retry'), 'Insufficient balance');
});
