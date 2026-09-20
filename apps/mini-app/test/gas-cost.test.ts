import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address, Hex } from 'viem';
import {
  MAX_FEE_PER_GAS_WEI,
  RouteGasCostCache,
  estimatePlannedRouteCost,
  formatRouteGasCost,
  routeGasCostKey,
} from '../src/lib/fx/gasCost';
import type { FxPublicClient, PlannedRoute } from '../src/lib/fx/types';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const token = '0x2222222222222222222222222222222222222222' as Address;
const actionTarget = '0x4444444444444444444444444444444444444444' as Address;

function route(withApproval = false): PlannedRoute {
  const approval = {
    chainId: 1 as const,
    from: wallet,
    to: token,
    data: '0x095ea7b300000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000064' as Hex,
    value: 0n,
    kind: 'approval' as const,
    operation: 'depositAndMint' as const,
  };
  const action = {
    chainId: 1 as const,
    from: wallet,
    to: actionTarget,
    data: '0x12345678' as Hex,
    value: 12n,
    kind: 'action' as const,
    operation: 'depositAndMint' as const,
  };
  return {
    operation: 'depositAndMint',
    chainId: 1,
    walletAddress: wallet,
    transactions: withApproval ? [approval, action] : [action],
  };
}

function clientFor(estimateGas: (to: Address) => Promise<bigint>, chainId: 1 | 8453 = 1): FxPublicClient {
  return {
    chain: { id: chainId },
    getChainId: async () => chainId,
    getBlockNumber: async () => 123n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 3n, maxPriorityFeePerGas: 1n }),
    estimateGas: async (args: { to: Address }) => estimateGas(args.to),
  } as unknown as FxPublicClient;
}

test('estimates every route step and separates gas from native transaction value', async () => {
  const planned = route();
  const estimate = await estimatePlannedRouteCost(planned, {
    client: clientFor(async () => 21_000n),
    now: () => 10_000,
  });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.blockNumber, 123n);
  assert.equal(estimate.estimatedGasUnits, 21_000n);
  assert.equal(estimate.executionGasFeeWei, 63_000n);
  assert.equal(estimate.nativeValueWei, 12n);
  assert.equal(estimate.totalNativeCostWei, 63_012n);
  assert.equal(estimate.steps[0].gasFeeWei, 63_000n);
});

test('keeps approval estimate when dependent action estimation fails', async () => {
  const planned = route(true);
  const estimate = await estimatePlannedRouteCost(planned, {
    client: clientFor(async (to) => {
      if (to.toLowerCase() === actionTarget.toLowerCase()) throw new Error('ERC20: insufficient allowance');
      return 46_000n;
    }),
  });
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.steps[0].status, 'estimated');
  assert.equal(estimate.steps[0].gas, 46_000n);
  assert.equal(estimate.steps[1].status, 'unavailable');
  assert.equal(estimate.estimatedGasUnits, undefined);
  assert.equal(estimate.executionGasFeeWei, undefined);
  assert.equal(estimate.totalNativeCostWei, undefined);
  assert.equal(estimate.nativeValueWei, 12n);
});

test('route key is scoped to account, chain, calldata, value, and operation', () => {
  const first = route();
  const second = { ...first, walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address };
  assert.notEqual(routeGasCostKey(first), routeGasCostKey(second));
});

test('rejects a transaction whose sender is outside the route account scope', async () => {
  const planned = route();
  planned.transactions[0].from = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
  const estimate = await estimatePlannedRouteCost(planned, {
    client: clientFor(async () => 21_000n),
  });
  assert.equal(estimate.status, 'unavailable');
  assert.match(estimate.error ?? '', /account or chain scope/);
});

test('Base includes OP Stack fee components and counts the bridge native fee once', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx', value: 7n }],
    quote: { nativeFee: 7n, lzTokenFee: 3n },
  };
  const client = clientFor(async () => 10n, 8453) as FxPublicClient & {
    estimateL1Fee: NonNullable<FxPublicClient['estimateL1Fee']>;
    estimateOperatorFee: NonNullable<FxPublicClient['estimateOperatorFee']>;
  };
  client.estimateL1Fee = async () => 4n;
  client.estimateOperatorFee = async () => 5n;
  const estimate = await estimatePlannedRouteCost(planned, { client });
  assert.equal(estimate.status, 'current');
  assert.equal(estimate.nativeValueWei, 7n);
  assert.equal(estimate.layerZeroNativeFeeWei, 7n);
  assert.equal(estimate.layerZeroTokenFeeWei, 3n);
  assert.equal(estimate.executionGasFeeWei, 30n);
  assert.equal(estimate.l1DataFeeWei, 4n);
  assert.equal(estimate.operatorFeeWei, 5n);
  assert.equal(estimate.totalNativeCostWei, 46n);
  assert.equal(estimate.totalNativeCostScope, 'execution-plus-l1-plus-operator-plus-value');
});

test('Base stays partial when L1/operator fee accounting is unavailable', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    operation: 'buildBridgeTx',
    transactions: [{ ...route().transactions[0], chainId: 8453, operation: 'buildBridgeTx' }],
    quote: { nativeFee: 7n, lzTokenFee: 3n },
  };
  const estimate = await estimatePlannedRouteCost(planned, { client: clientFor(async () => 10n, 8453) });
  assert.equal(estimate.status, 'partial');
  assert.equal(estimate.executionGasFeeWei, 30n);
  assert.equal(estimate.totalNativeCostWei, undefined);
});

test('cache never exposes an expired estimate as current while refreshing', async () => {
  let now = 1000;
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const cache = new RouteGasCostCache({ now: () => now, ttlMs: 1000 });
  const planned = route();
  const client = clientFor(async () => {
    await delayed;
    return 21_000n;
  });
  const first = cache.refresh(planned, { client });
  assert.equal(cache.view(planned).status, 'refreshing');
  release?.();
  await first;
  assert.equal(cache.view(planned).status, 'current');
  now = 2501;
  const second = cache.refresh(planned, { client });
  const whileRefreshing = cache.view(planned);
  assert.equal(whileRefreshing.status, 'refreshing');
  assert.equal(whileRefreshing.current, undefined);
  assert.ok(whileRefreshing.previous);
  release?.();
  await second;
});

test('aborted estimates fail closed without returning a fabricated result', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    estimatePlannedRouteCost(route(), { client: clientFor(async () => 1n), signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});

test('zero RPC gas or fee values are unavailable rather than treated as a default', async () => {
  const planned = route();
  const zeroClient = {
    ...clientFor(async () => 0n),
    estimateFeesPerGas: async () => ({ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }),
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, { client: zeroClient });
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.steps[0].status, 'unavailable');
  assert.equal(estimate.estimatedGasUnits, undefined);
  assert.equal(estimate.executionGasFeeWei, undefined);
});

test('RPC fee and gas values are bounded before cost arithmetic', async () => {
  const planned: PlannedRoute = {
    ...route(),
    chainId: 8453,
    transactions: [{ ...route().transactions[0], chainId: 8453 }],
  };
  const client = {
    ...clientFor(async () => 1_000_000_001n, 8453),
    estimateFeesPerGas: async () => ({ maxFeePerGas: MAX_FEE_PER_GAS_WEI + 1n, maxPriorityFeePerGas: 1n }),
    getGasPrice: async () => MAX_FEE_PER_GAS_WEI + 1n,
  } as FxPublicClient;
  const estimate = await estimatePlannedRouteCost(planned, { client });
  assert.equal(estimate.status, 'unavailable');
  assert.equal(estimate.steps[0].status, 'unavailable');
  assert.equal(estimate.executionGasFeeWei, undefined);
});

test('formats tiny gas costs in Gwei and labels legacy fees without max wording', () => {
  const formatted = formatRouteGasCost({
    routeKey: 'test',
    walletAddress: wallet,
    chainId: 1,
    operation: 'depositAndMint',
    status: 'current',
    fetchedAt: 1,
    validUntil: 2,
    fee: { mode: 'legacy', feePerGasWei: 1n },
    steps: [{ index: 0, kind: 'action', status: 'estimated', gas: 21_000n }],
    estimatedGasUnits: 21_000n,
    executionGasFeeWei: 21_000n,
    nativeValueWei: 0n,
    totalNativeCostWei: 21_000n,
    totalNativeCostScope: 'execution-plus-value',
  });
  assert.equal(formatted.gasFee, '0.000021 Gwei');
  assert.equal(formatted.totalCost, '0.000021 Gwei (native value + execution fee)');
});

test('clear invalidates an in-flight estimate so it cannot repopulate the cache', async () => {
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const cache = new RouteGasCostCache();
  const planned = route();
  const request = cache.refresh(planned, {
    client: clientFor(async () => {
      await delayed;
      return 21_000n;
    }),
  });
  cache.clear();
  release?.();
  await request;
  assert.equal(cache.view(planned).status, 'unavailable');
  assert.equal(cache.view(planned).current, undefined);
});

test('clear does not let an old request cleanup delete a newer request', async () => {
  let firstRelease: (() => void) | undefined;
  let secondRelease: (() => void) | undefined;
  let calls = 0;
  const cache = new RouteGasCostCache();
  const planned = route();
  const client = clientFor(async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      if (calls === 1) firstRelease = resolve;
      else secondRelease = resolve;
    });
    return 21_000n;
  });
  const old = cache.refresh(planned, { client });
  cache.clear(planned);
  const current = cache.refresh(planned, { client });
  assert.equal(cache.view(planned).status, 'refreshing');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  firstRelease?.();
  await old;
  assert.equal(cache.view(planned).status, 'refreshing');
  secondRelease?.();
  await current;
  assert.equal(cache.view(planned).status, 'current');
});

test('clearing one route does not strand another route in-flight entry', async () => {
  const secondTarget = '0x5555555555555555555555555555555555555555' as Address;
  let releaseA: (() => void) | undefined;
  let releaseB: (() => void) | undefined;
  let bCalls = 0;
  const delayedA = new Promise<void>((resolve) => { releaseA = resolve; });
  const delayedB = new Promise<void>((resolve) => { releaseB = resolve; });
  const plannedA = route();
  const plannedB: PlannedRoute = {
    ...plannedA,
    transactions: [{ ...plannedA.transactions[0], to: secondTarget }],
  };
  const client = clientFor(async (to) => {
    if (to.toLowerCase() === actionTarget.toLowerCase()) await delayedA;
    if (to.toLowerCase() === secondTarget.toLowerCase() && bCalls++ === 0) await delayedB;
    return 21_000n;
  });
  const cache = new RouteGasCostCache();
  const requestA = cache.refresh(plannedA, { client });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const requestB = cache.refresh(plannedB, { client });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  cache.clear(plannedA);
  releaseB?.();
  await requestB;
  const secondB = cache.refresh(plannedB, { client });
  assert.notEqual(secondB, requestB);
  releaseA?.();
  await Promise.all([requestA, secondB]);
});
