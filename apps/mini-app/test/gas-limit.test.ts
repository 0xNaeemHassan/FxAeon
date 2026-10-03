import assert from 'node:assert/strict';
import test from 'node:test';
import { gasLimitMaxFeeCost, gasLimitWithHeadroom } from '../src/lib/fx/gasLimit';

test('shared wallet gas limit rounds the same 20 percent headroom used at execution', () => {
  assert.equal(gasLimitWithHeadroom(100_001n), 120_002n);
  assert.equal(gasLimitWithHeadroom(21_000n), 25_200n);
  assert.equal(gasLimitMaxFeeCost(21_000n, 40n), 1_008_000n);
  assert.throws(() => gasLimitWithHeadroom(0n), /must be positive/);
  assert.throws(() => gasLimitMaxFeeCost(21_000n, 0n), /must be positive/);
});
