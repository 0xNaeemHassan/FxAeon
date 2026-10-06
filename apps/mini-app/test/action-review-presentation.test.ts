import assert from 'node:assert/strict';
import test from 'node:test';
import { missingGasFeeFact, missingTotalCostFact, routeFacts } from '../src/components/review/actionReviewPresentation';
import type { RouteGasCostEstimate } from '../src/lib/fx/gasCost';
import type { PlannedRoute } from '../src/lib/fx';

const route = (value = 0n): PlannedRoute => ({
  operation: 'increasePosition',
  chainId: 1,
  walletAddress: '0x1111111111111111111111111111111111111111',
  transactions: [{ to: '0x2222222222222222222222222222222222222222', data: '0x1234', value, kind: 'action' }],
} as unknown as PlannedRoute);

function estimate({ nativeValueWei = 0n, executionGasFeeWei = 1_000_000_000_000_000n, totalNativeCostWei = executionGasFeeWei }: {
  nativeValueWei?: bigint;
  executionGasFeeWei?: bigint;
  totalNativeCostWei?: bigint;
} = {}): RouteGasCostEstimate {
  return {
    routeKey: 'route',
    chainId: 1,
    walletAddress: route().walletAddress,
    operation: 'increasePosition',
    status: 'current',
    fetchedAt: 1,
    validUntil: 2,
    steps: [],
    nativeValueWei,
    executionGasFeeWei,
    totalNativeCostWei,
  };
}

test('gas fee row remains stable while the optional estimate loads and reports failure without blocking', () => {
  const loading = { status: 'refreshing' as const, estimateIsCurrent: false, estimate: undefined, error: undefined };
  assert.deepEqual(missingGasFeeFact(loading), { label: 'Gas fee', value: '—' });

  const unavailable = { status: 'unavailable' as const, estimateIsCurrent: false, estimate: undefined, error: 'RPC unavailable' };
  assert.deepEqual(missingGasFeeFact(unavailable), {
    label: 'Gas fee', value: 'Unavailable',
  });
  assert.deepEqual(missingGasFeeFact({ status: 'unavailable', estimateIsCurrent: false, estimate: undefined, error: undefined }), {
    label: 'Gas fee', value: 'Unavailable',
  });
});

test('reserves a total-cost row only for a route that sends native value', () => {
  assert.deepEqual(missingTotalCostFact(route(), { status: 'refreshing', estimateIsCurrent: false }), undefined);
  assert.deepEqual(missingTotalCostFact(route(1n), { status: 'refreshing', estimateIsCurrent: false }), {
    label: 'Total cost', value: '—',
  });
  assert.deepEqual(missingTotalCostFact(route(1n), { status: 'unavailable', estimateIsCurrent: false }), {
    label: 'Total cost', value: 'Unavailable',
  });
});

test('total cost is omitted only when zero native value makes it numerically equal to gas fee', () => {
  const gasOnly = estimate();
  const facts = routeFacts(route(), { estimate: gasOnly, estimateIsCurrent: true });
  assert.deepEqual(facts.map(({ label }) => label), ['Gas fee']);

  const withAdditionalNativeCost = estimate({ totalNativeCostWei: 1_100_000_000_000_000n });
  const differentTotalFacts = routeFacts(route(), { estimate: withAdditionalNativeCost, estimateIsCurrent: true });
  assert.deepEqual(differentTotalFacts.map(({ label }) => label), ['Gas fee', 'Total cost']);

  const nonzeroNativeRoute = estimate({ nativeValueWei: 1n });
  const nonzeroNativeFacts = routeFacts(route(1n), { estimate: nonzeroNativeRoute, estimateIsCurrent: true });
  assert.deepEqual(nonzeroNativeFacts.map(({ label }) => label), ['Gas fee', 'Total cost']);
});

test('Base gas combines network components without duplicating a fee-only total', () => {
  const baseEstimate = {
    ...estimate({ executionGasFeeWei: 1_000_000_000n, totalNativeCostWei: 1_300_000_000n }),
    chainId: 8453 as const,
    l1DataFeeWei: 200_000_000n,
    operatorFeeWei: 100_000_000n,
  };
  const baseRoute = { ...route(), chainId: 8453 as const };
  const facts = routeFacts(baseRoute, { estimate: baseEstimate, estimateIsCurrent: true });
  assert.deepEqual(facts.map(({ label, value }) => ({ label, value })), [{ label: 'Gas fee', value: '1.3 Gwei max' }]);
  const withValue = { ...baseEstimate, nativeValueWei: 500_000_000n, totalNativeCostWei: 1_800_000_000n };
  const valueFacts = routeFacts({ ...baseRoute, transactions: route(500_000_000n).transactions }, { estimate: withValue, estimateIsCurrent: true });
  assert.deepEqual(valueFacts.map(({ label, value }) => ({ label, value })), [
    { label: 'Gas fee', value: '1.3 Gwei max' },
    { label: 'Total cost', value: '1.8 Gwei max' },
  ]);
});
