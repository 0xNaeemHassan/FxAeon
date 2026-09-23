import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptedRouteTerms, canAcceptReviewedRoute, changedConsequenceFacts, consequenceSummary, pairVerifiedPositionFacts, reviewActionLabel, reviewGenerationIsCurrent, reviewSessionMismatch, transitionReviewStage, updatedRouteTermsRequired } from '../src/components/review/actionReviewModel';
import type { PlannedRoute } from '../src/lib/fx';

const route = (data = '0x1234'): PlannedRoute => ({
  operation: 'increasePosition', chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111',
  transactions: [{ to: '0x2222222222222222222222222222222222222222', data, value: 0n, kind: 'action' }],
  details: { routeType: 'direct', requestedAmount: '100', requestedLeverage: '2', slippagePercent: '1' },
} as unknown as PlannedRoute);

test('review stage transitions reject impossible events and lock the draft while wallet is pending', () => {
  assert.equal(transitionReviewStage('input', 'begin-signing'), 'executing', 'legacy direct-action callers retain their execution path');
  assert.equal(transitionReviewStage('input', 'prepare'), 'planning');
  assert.equal(transitionReviewStage('planning', 'prepared'), 'review');
  assert.equal(transitionReviewStage('review', 'begin-signing'), 'executing');
  assert.equal(transitionReviewStage('executing', 'return-to-input', true), 'executing');
  assert.equal(transitionReviewStage('executing', 'completed'), 'result');
  assert.equal(canAcceptReviewedRoute('executing', true), false, 'a pending wallet request cannot accept replacement terms');
  assert.equal(canAcceptReviewedRoute('review', true), false);
  assert.equal(canAcceptReviewedRoute('review', false), true);
});

test('wallet, chain, and reconnect changes invalidate the accepted review session', () => {
  const session = { walletAddress: '0xAbc', chainId: 1, connectionVersion: 4 };
  assert.equal(reviewSessionMismatch(session, { ...session, walletAddress: '0xabc', authenticated: true }), null);
  assert.equal(reviewSessionMismatch(session, { ...session, walletAddress: '0xdef', authenticated: true }), 'wallet');
  assert.equal(reviewSessionMismatch(session, { ...session, chainId: 8453, authenticated: true }), 'network');
  assert.equal(reviewSessionMismatch(session, { ...session, connectionVersion: 5, authenticated: true }), 'connection');
  assert.equal(reviewSessionMismatch(session, { ...session, authenticated: false }), 'wallet');
});

test('stale and unmounted lifecycle generations cannot publish results', () => {
  assert.equal(reviewGenerationIsCurrent(true, 4, 4), true);
  assert.equal(reviewGenerationIsCurrent(true, 5, 4), false);
  assert.equal(reviewGenerationIsCurrent(false, 4, 4), false);
});

test('accepted route terms remain distinguishable from a refreshed quote', () => {
  const accepted = acceptedRouteTerms(route());
  assert.equal(accepted, acceptedRouteTerms(route()));
  assert.equal(updatedRouteTermsRequired(accepted, route()), false);
  assert.notEqual(accepted, acceptedRouteTerms(route('0xabcd')));
  assert.equal(updatedRouteTermsRequired(accepted, route('0xabcd')), true);
});

test('consequence summary exposes only facts supported by route display facts', () => {
  assert.deepEqual(consequenceSummary([
    { label: 'Input amount', value: '10 ETH' }, { label: 'Expected receive', value: '9 fxUSD' },
    { label: 'Oracle source', value: 'validated read' },
  ]), [
    { label: 'Input amount', value: '10 ETH' }, { label: 'Expected receive', value: '9 fxUSD' },
  ]);
});

test('review action copy preserves token and network branding', () => {
  assert.equal(reviewActionLabel('Send fxUSD to Base', 'Send fxUSD to Base'), 'Review fxUSD to Base');
  assert.equal(reviewActionLabel('Review fxSAVE withdrawal'), 'Review fxSAVE withdrawal');
});

test('quote refresh change summary lists only changed supported consequences', () => {
  assert.deepEqual(changedConsequenceFacts(
    [{ label: 'Amount', value: '1 ETH' }, { label: 'Route', value: 'Terms 1' }],
    [{ label: 'Amount', value: '2 ETH' }, { label: 'Route', value: 'Terms 2' }],
  ), [{ label: 'Amount', before: '1 ETH', after: '2 ETH' }]);
});

test('current and expected position values pair only when the quote provides the expected metric', () => {
  assert.deepEqual(pairVerifiedPositionFacts(
    [{ label: 'Collateral', value: '4 ETH' }, { label: 'Debt', value: '100 fxUSD' }],
    [{ label: 'Estimated collateral', value: '5 ETH' }, { label: 'Estimated debt', value: '120 fxUSD' }],
  ), {
    paired: [
      { label: 'Collateral', before: '4 ETH', after: '5 ETH' },
      { label: 'Debt', before: '100 fxUSD', after: '120 fxUSD' },
    ],
    remainingBefore: [],
  });
  assert.deepEqual(pairVerifiedPositionFacts([{ label: 'Collateral', value: '4 ETH' }], []), {
    paired: [], remainingBefore: [{ label: 'Collateral', value: '4 ETH' }],
  });
});
