import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateNativeMax, type NativeMaxEstimate } from '../src/lib/fx/nativeMax';

function estimate(amount: bigint, reserve: bigint, validUntil = 10_000): NativeMaxEstimate {
  return {
    status: 'current',
    nativeValueWei: amount,
    totalNativeCostWei: amount + reserve,
    totalNativeCostScope: 'execution-plus-value',
    validUntil,
  };
}

test('native max converges from a fundable half balance and verifies the final amount', async () => {
  const calls: bigint[] = [];
  const result = await calculateNativeMax({
    balanceWei: 1_000n,
    buildRoutes: async (amount) => { calls.push(amount); return [amount]; },
    estimateRoutes: async ([amount]) => [estimate(amount, 100n)],
    now: () => 1,
  });
  assert.equal(result, 900n);
  assert.deepEqual(calls.at(-1), 900n);
});

test('partial estimates fail closed instead of returning a maximum', async () => {
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 1_000n,
    maxIterations: 4,
    buildRoutes: async (amount) => [amount],
    estimateRoutes: async () => [{ ...estimate(1n, 100n), status: 'partial' }],
  }), /current gas estimate is unavailable/);
});

test('expired estimates fail closed even when marked current', async () => {
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 1_000n,
    maxIterations: 4,
    buildRoutes: async (amount) => [amount],
    estimateRoutes: async ([amount]) => [estimate(amount, 100n, 100)],
    now: () => 100,
  }), /current gas estimate is unavailable/);
});

test('nonconvergent reserve never returns the last approximate candidate', async () => {
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 1_000n,
    initialCandidateWei: 500n,
    maxIterations: 4,
    now: () => 1,
    buildRoutes: async (amount) => [amount],
    estimateRoutes: async ([amount]) => [estimate(amount, 1_001n - amount)],
  }), /did not converge/);
});

test('a balance epoch change invalidates the in-flight calculation', async () => {
  let current = true;
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 1_000n,
    now: () => 1,
    buildRoutes: async (amount) => [amount],
    estimateRoutes: async ([amount]) => {
      current = false;
      return [estimate(amount, 100n)];
    },
    isCurrent: () => current,
  }), /request is stale/);
});
