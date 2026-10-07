import assert from 'node:assert/strict';
import test from 'node:test';
import { stableTradeReviewFacts } from '../src/components/review/stableTradeReviewFacts';
const entered = [{ label: 'Amount', value: '0.0003 ETH' }, { label: 'Target leverage', value: '2.8×' }, { label: 'Position', value: 'New position' }, { label: 'Slippage', value: '0.5%' }];
const state = { preparing: true, failed: false, checkingGas: false };
test('known trade inputs retain their slots and exact values while unknown values fill in', () => {
  const before = stableTradeReviewFacts(entered, [], state);
  const after = stableTradeReviewFacts(entered, [...entered, { label: 'Estimated collateral', value: '0.0007 wstETH' }, { label: 'Gas fee', value: '0.001 ETH' }], { ...state, preparing: false });
  assert.deepEqual(before.map(f => f.label), after.map(f => f.label));
  for (const input of entered) { assert.deepEqual(before.find(f => f.label === input.label), input); assert.deepEqual(after.find(f => f.label === input.label), input); }
  assert.equal(before.find(f => f.label === 'Estimated collateral')?.value, '—');
  assert.equal(after.find(f => f.label === 'Estimated collateral')?.value, '0.0007 wstETH');
});
test('failed preparation stops loading placeholders without inventing quote values', () => {
  const failed = stableTradeReviewFacts(entered, [], { ...state, failed: true });
  assert.equal(failed.some(f => f.value === '—'), false);
  assert.equal(failed.find(f => f.label === 'Gas fee')?.value, 'Unavailable');
});
test('pending fee refresh does not present an older price as newly checked', () => {
  const pending = stableTradeReviewFacts(entered, [{ label: 'Gas fee', value: '0.001 ETH' }], { ...state, preparing: false, checkingGas: true });
  assert.equal(pending.find(f => f.label === 'Gas fee')?.value, '—');
});
test('verified direct-input omissions are labelled without fabricating a conversion or fee', () => {
  const complete = stableTradeReviewFacts(entered, [{ label: 'Gas fee', value: '0.001 ETH' }], { ...state, preparing: false, hasVerifiedRoute: true, totalIsGasOnly: true });
  assert.equal(complete.find(f => f.label === 'Total cost')?.value, 'Included in gas fee');
  assert.equal(complete.find(f => f.label === 'Minimum converted input')?.value, 'Not quoted');
});

test('verified route terms override live form changes during review and signing', () => {
  const changed = entered.map(fact => ({ ...fact, value: 'changed live input' }));
  for (const preparing of [false, true]) {
    const facts = stableTradeReviewFacts(changed, entered, { ...state, preparing, hasVerifiedRoute: true });
    for (const original of entered) assert.deepEqual(facts.find(fact => fact.label === original.label), original);
  }
});
test('missing verified terms never fall back to unverified current inputs', () => {
  const facts = stableTradeReviewFacts(entered, [], { ...state, preparing: false, hasVerifiedRoute: true });
  for (const input of entered) assert.equal(facts.find(fact => fact.label === input.label)?.value, 'Unavailable');
});
