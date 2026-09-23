import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoverDirectWalletPositionIds,
  DIRECT_POSITION_SCAN_MAX_IDS,
  type DirectPositionDiscoveryParams,
} from '../src/app/trade/directPositionDiscovery';
import { readCanonicalPositionContext, readCanonicalPositionInfo } from '../src/app/trade/canonicalPositionReader';
import { POSITION_INDEXER_READ_TIMEOUT_MS, readPositionGroupWithDirectFallback, verifyPositionGroupOwnership } from '../src/app/trade/fxUi';
import type { FxPublicClient } from '../src/lib/fx/types';
import type { PositionGroup } from '../src/app/trade/fxUi';

const wallet = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const group: PositionGroup = { market: 'ETH', side: 'long' };
const WAD = 10n ** 18n;

function mockClient(options: {
  balance?: bigint;
  nextId?: bigint;
  ownedIds?: readonly number[];
  position?: readonly [bigint, bigint];
  rate?: bigint;
  quote?: bigint;
  balances?: readonly bigint[];
}): DirectPositionDiscoveryParams['client'] & { calls: string[] } {
  const owned = new Set(options.ownedIds ?? []);
  let balanceRead = 0;
  const calls: string[] = [];
  return {
    calls,
    readContract: async (args: { functionName: string }) => {
      calls.push(args.functionName);
      if (args.functionName === 'balanceOf') {
        const value = options.balances?.[balanceRead] ?? options.balance ?? 0n;
        balanceRead += 1;
        return value;
      }
      if (args.functionName === 'getNextPositionId') return options.nextId ?? 1n;
      if (args.functionName === 'getPosition') return options.position ?? [2n * WAD, WAD];
      if (args.functionName === 'ownerOf') {
        const id = Number((args as { args?: readonly [bigint] }).args?.[0]);
        if (!owned.has(id)) throw new Error('foreign or burned');
        return wallet;
      }
      if (args.functionName === 'getRate') return options.rate ?? WAD;
      if (args.functionName === 'queryConvert') {
        const amount = (args as { args?: readonly [bigint] }).args?.[0];
        return options.quote ?? amount ?? 100n * WAD;
      }
      throw new Error(`unexpected read ${args.functionName}`);
    },
    multicall: async ({ contracts }: { contracts: readonly { args: readonly [bigint] }[] }) => contracts.map(({ args }) => {
      const id = Number(args[0]);
      return owned.has(id)
        ? { status: 'success', result: wallet }
        : { status: 'failure', error: new Error('burned or foreign') };
    }),
  } as DirectPositionDiscoveryParams['client'] & { calls: string[] };
}

test('complete verified indexer coverage avoids a direct scan', async () => {
  const client = mockClient({ balance: 1n, ownedIds: [7] });
  const result = await discoverDirectWalletPositionIds({
    client,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [7],
  });
  assert.deepEqual(result, { ids: [7], expectedCount: 1n, usedScan: false });
  assert.equal(client.calls.includes('getNextPositionId'), false);
});

test('indexer deficit falls back to ownerOf batches and tolerates burned IDs', async () => {
  const client = mockClient({ balance: 1n, nextId: 9n, ownedIds: [7] });
  const result = await discoverDirectWalletPositionIds({
    client,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [],
  });
  assert.deepEqual(result, { ids: [7], expectedCount: 1n, usedScan: true });
  assert.equal(client.calls.filter((call) => call === 'getNextPositionId').length, 1);
});

test('a wallet-scoped candidate cache rechecks ownership and recovers a transferred NFT', async () => {
  const first = mockClient({ balance: 1n, nextId: 8n, ownedIds: [7] });
  await discoverDirectWalletPositionIds({ client: first, group, walletAddress: wallet, verifiedIndexerIds: [] });
  const repeat = mockClient({ balance: 1n, nextId: BigInt(DIRECT_POSITION_SCAN_MAX_IDS + 1), ownedIds: [7] });
  const repeated = await discoverDirectWalletPositionIds({ client: repeat, group, walletAddress: wallet, verifiedIndexerIds: [] });
  assert.deepEqual(repeated.ids, [7]);
  assert.equal(repeat.calls.includes('getNextPositionId'), false, 'healthy cached candidates avoid a full range scan');
  const transferred = mockClient({ balance: 1n, nextId: 10n, ownedIds: [8] });
  const result = await discoverDirectWalletPositionIds({ client: transferred, group, walletAddress: wallet, verifiedIndexerIds: [] });
  assert.deepEqual(result.ids, [8]);
  assert.equal(transferred.calls.includes('getNextPositionId'), true, 'ownership change invalidates the cached candidate and scans again');
});

test('zero NFT ownership is an honest empty result and skips scanning', async () => {
  const client = mockClient({ balance: 0n, nextId: 4000n });
  const result = await discoverDirectWalletPositionIds({
    client,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [],
  });
  assert.deepEqual(result, { ids: [], expectedCount: 0n, usedScan: false });
  assert.equal(client.calls.includes('getNextPositionId'), false);
});

test('a capped or incomplete scan rejects instead of reporting an empty wallet', async () => {
  const capped = mockClient({ balance: 1n, nextId: BigInt(DIRECT_POSITION_SCAN_MAX_IDS + 2) });
  await assert.rejects(() => discoverDirectWalletPositionIds({
    client: capped,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [],
  }), /exceeds/);

  const incomplete = mockClient({ balance: 1n, nextId: 4n, ownedIds: [] });
  await assert.rejects(() => discoverDirectWalletPositionIds({
    client: incomplete,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [],
  }), /incomplete/);
});

test('canonical reader preserves SDK long leverage and token metadata', async () => {
  const client = mockClient({ position: [2n * WAD, WAD] });
  const info = await readCanonicalPositionInfo({ client, group, positionId: 7 });
  assert.equal(info.rawColls, 2n * WAD);
  assert.equal(info.rawDebts, WAD);
  assert.equal(info.currentLeverage, 2);
  assert.equal(info.lsdLeverage, 2);
  assert.equal(info.rawCollsToken, 'ETH');
  assert.equal(info.rawDebtsToken, 'fxUSD');
  assert.equal(info.rawCollsDecimals, 18);
  assert.equal(info.rawDebtsDecimals, 18);
});

test('failed or delayed indexer discovery still exposes a directly held foreign-to-indexer NFT', async () => {
  const client = mockClient({ balance: 1n, nextId: 4n, ownedIds: [3] });
  const result = await readPositionGroupWithDirectFallback({
    client: client as unknown as FxPublicClient,
    sdk: { getPositions: async () => { await new Promise((resolve) => setTimeout(resolve, 40)); throw new Error('indexer delayed'); } },
    walletAddress: wallet,
    group,
    indexerTimeoutMs: 5,
  });
  assert.deepEqual(result.map((info) => info.positionId), [3]);
});

test('SDK index hydration may exceed three seconds without triggering historical discovery', async () => {
  assert.ok(POSITION_INDEXER_READ_TIMEOUT_MS > 3_000);
  const client = mockClient({ balance: 1n, ownedIds: [7] });
  const result = await readPositionGroupWithDirectFallback({
    client: client as unknown as FxPublicClient,
    sdk: {
      getPositions: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return [{
          positionId: 7,
          rawColls: 2n * WAD,
          rawDebts: WAD,
          currentLeverage: 2,
          lsdLeverage: 2,
          rawCollsToken: 'ETH',
          rawDebtsToken: 'fxUSD',
          rawCollsDecimals: 18,
          rawDebtsDecimals: 18,
        }];
      },
    },
    walletAddress: wallet,
    group,
    // Keep the harness quick while exercising a delayed SDK result within
    // the same configurable production budget.
    indexerTimeoutMs: 100,
  });
  assert.deepEqual(result.map((info) => info.positionId), [7]);
  assert.equal(client.calls.includes('getNextPositionId'), false);
});

test('a fast index result is rejected when the wallet NFT count changes before completion', async () => {
  const client = mockClient({ balances: [1n, 2n], ownedIds: [7] });
  const result = readPositionGroupWithDirectFallback({
    client: client as unknown as FxPublicClient,
    sdk: {
      getPositions: async () => [{
        positionId: 7,
        rawColls: 2n * WAD,
        rawDebts: WAD,
        currentLeverage: 2,
        lsdLeverage: 2,
        rawCollsToken: 'wstETH',
        rawDebtsToken: 'fxUSD',
        rawCollsDecimals: 18,
        rawDebtsDecimals: 18,
      }],
    },
    walletAddress: wallet,
    group,
  });
  await assert.rejects(result, /ownership changed/);
});

test('canonical short metadata applies the SDK rate normalization and LSD leverage', async () => {
  const client = mockClient({ position: [2n * WAD, WAD], rate: 2n * WAD });
  const info = await readCanonicalPositionInfo({
    client,
    group: { market: 'ETH', side: 'short' },
    positionId: 3,
  });
  assert.equal(info.rawDebts, WAD, 'raw debt remains the protocol value');
  assert.equal(info.currentLeverage, 2);
  assert.equal(info.lsdLeverage, 1);
  assert.equal(info.rawCollsToken, 'fxUSD');
  assert.equal(info.rawDebtsToken, 'wstETH');
});

test('canonical BTC readers retain the SDK 18-decimal position contract on long and short pools', async () => {
  for (const side of ['long', 'short'] as const) {
    const client = mockClient({ position: [2n * WAD, side === 'short' ? 100_000_000n : WAD], quote: 100_000n });
    const info = await readCanonicalPositionInfo({ client, group: { market: 'BTC', side }, positionId: 9 });
    assert.equal(info.rawCollsDecimals, 18);
    assert.equal(info.rawDebtsDecimals, 18);
    assert.equal(info.rawCollsToken, side === 'long' ? 'WBTC' : 'fxUSD');
    assert.equal(info.rawDebtsToken, side === 'long' ? 'fxUSD' : 'WBTC');
    assert.ok(Number.isFinite(info.currentLeverage));
  }
});

test('BTC pricing chooses the best available SDK route independently in each direction', async () => {
  for (const legacyFails of [false, true]) {
    const client = {
      readContract: async ({ args }: { args: readonly [bigint, bigint, readonly string[]] }) => {
        const [amount, , routes] = args;
        const v3 = routes.some((route) => route.includes('d269dc8063ef5dff34b49595f97151eebfcff5f458'));
        if (!v3 && legacyFails) throw new Error('legacy pool unavailable');
        // V3 wins the buy quote. The legacy route wins the sell quote when available.
        return amount === 100n * WAD ? (v3 ? 200_000n : 100_000n) : (v3 ? 8n * WAD : 10n * WAD);
      },
    } as unknown as FxPublicClient;
    const context = await readCanonicalPositionContext({ client, group: { market: 'BTC', side: 'long' } });
    assert.equal(context.averageNumerator, BigInt(legacyFails ? 65_000 : 75_000) * context.averageDenominator);
  }
});

test('BTC pricing rejects a refresh when both candidate routes fail', async () => {
  const client = { readContract: async () => { throw new Error('unavailable'); } } as unknown as FxPublicClient;
  await assert.rejects(readCanonicalPositionContext({ client, group: { market: 'BTC', side: 'short' } }), /quotes unavailable/);
});

test('zero-accounting owned indexer IDs satisfy completeness without scanning history', async () => {
  const client = mockClient({ balance: 1n, ownedIds: [7], position: [0n, 0n] });
  const result = await readPositionGroupWithDirectFallback({
    client: client as unknown as FxPublicClient,
    sdk: {
      getPositions: async () => [{
        positionId: 7,
        rawColls: 0n,
        rawDebts: 0n,
        currentLeverage: 0,
        lsdLeverage: 0,
        rawCollsToken: 'ETH',
        rawDebtsToken: 'fxUSD',
        rawCollsDecimals: 18,
        rawDebtsDecimals: 18,
      }],
    },
    walletAddress: wallet,
    group,
  });
  assert.deepEqual(result.map((info) => info.positionId), [7]);
  assert.equal(client.calls.includes('getNextPositionId'), false, 'a complete owned ID set avoids the bounded history scan');
});

test('nonzero canonical accounting with uncertain owner remains unverified', async () => {
  const client = mockClient({ balance: 1n, ownedIds: [] });
  await assert.rejects(verifyPositionGroupOwnership({
    client,
    walletAddress: wallet,
    group,
    positions: [{
      positionId: 7,
      rawColls: 2n * WAD,
      rawDebts: WAD,
      currentLeverage: 2,
      lsdLeverage: 2,
      rawCollsToken: 'ETH',
      rawDebtsToken: 'fxUSD',
      rawCollsDecimals: 18,
      rawDebtsDecimals: 18,
    }],
  }), /foreign or burned/);
});
