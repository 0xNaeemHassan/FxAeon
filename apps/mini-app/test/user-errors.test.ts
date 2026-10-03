import assert from 'node:assert/strict';
import test from 'node:test';
import { userSafeError } from '../src/lib/errors';

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
