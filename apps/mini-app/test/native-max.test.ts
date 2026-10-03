import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateNativeMax, nativeMaxErrorMessage, type NativeMaxEstimate } from '../src/lib/fx/nativeMax';

function estimate(amount: bigint, reserve: bigint, validUntil = 10_000): NativeMaxEstimate {
  return {
    status: 'current',
    nativeValueWei: amount,
    totalNativeCostWei: amount + reserve,
    requiredNativeCostWei: amount + reserve,
    totalNativeCostScope: 'execution-plus-value',
    validUntil,
  };
}

test('native max converges from a fundable half balance and verifies the final amount', async () => {
  const calls: bigint[] = [];
  const estimated: bigint[] = [];
  const result = await calculateNativeMax({
    balanceWei: 1_000n,
    buildRoutes: async (amount) => { calls.push(amount); return [amount]; },
    estimateRoutes: async ([amount]) => { estimated.push(amount); return [estimate(amount, 100n)]; },
    now: () => 1,
  });
  assert.equal(result, 900n);
  assert.deepEqual(calls, [500n, 900n]);
  assert.deepEqual(estimated, calls, 'the returned amount itself was estimated and no duplicate final build occurred');
});

test('exact candidate is not returned if its completed estimate expires before return', async () => {
  let clockReads = 0;
  let builds = 0;
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 100n,
    buildRoutes: async (amount) => { builds += 1; return [amount]; },
    estimateRoutes: async ([amount]) => [estimate(amount, 50n, 2)],
    now: () => ++clockReads === 1 ? 1 : 2,
  }), /current gas estimate is unavailable/);
  assert.equal(builds, 1);
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

test('SDK leverage errors fail immediately without rebuilding smaller candidates', async () => {
  let builds = 0;
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 79n,
    buildRoutes: async () => {
      builds += 1;
      throw new Error('SDK leverage must be >= 2x for this route');
    },
    estimateRoutes: async () => [estimate(1n, 1n)],
  }), /leverage must be/);
  assert.equal(builds, 1);
});

test('explicit insufficient-funds simulation backs off then verifies the exact fundable amount', async () => {
  const built: bigint[] = [];
  const result = await calculateNativeMax({
    balanceWei: 1_000n,
    initialCandidateWei: 900n,
    buildRoutes: async (amount) => {
      built.push(amount);
      if (amount > 800n) throw new Error('insufficient funds for gas * price + value');
      return [amount];
    },
    estimateRoutes: async ([amount]) => [estimate(amount, 300n)],
    now: () => 1,
  });
  assert.equal(result, 700n);
  assert.deepEqual(built, [900n, 450n, 700n]);
});

test('reserve consuming the full balance never returns a partial maximum', async () => {
  let builds = 0;
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 10n,
    initialCandidateWei: 5n,
    maxIterations: 3,
    buildRoutes: async (amount) => { builds += 1; return [amount]; },
    estimateRoutes: async ([amount]) => [estimate(amount, 10n)],
    now: () => 1,
  }), /does not cover the verified gas reserve|did not converge/);
  assert.equal(builds, 2, 'only one amount-dependent reserve retry is allowed');
});

test('wall timeout aborts the active callback and prevents later retries', async () => {
  let builds = 0;
  let signal: AbortSignal | undefined;
  await assert.rejects(() => calculateNativeMax({
    balanceWei: 1_000n,
    timeoutMs: 100,
    buildRoutes: async (_amount, requestSignal) => {
      builds += 1;
      signal = requestSignal;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return [1n];
    },
    estimateRoutes: async ([amount]) => [estimate(amount, 1n)],
  }), /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(signal?.aborted, true);
  assert.equal(builds, 1);
});

test('native Max errors are mapped to concise user-safe messages', () => {
  assert.equal(nativeMaxErrorMessage(new Error('wallet balance does not cover the verified gas reserve')), 'Not enough ETH for network fees.');
  assert.equal(nativeMaxErrorMessage(new Error('native max estimate timed out')), 'Gas estimate timed out. Try again.');
  assert.equal(nativeMaxErrorMessage(new Error('SDK leverage must be >= 2x for this route')), 'Could not calculate Max. Try again.');
});
