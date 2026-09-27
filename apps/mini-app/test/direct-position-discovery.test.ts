import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIRECT_POSITION_CANDIDATE_SESSION_KEY,
  DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES,
  discoverDirectWalletPositionIds,
  DIRECT_POSITION_SCAN_MAX_IDS,
  parsePositionCandidateCache,
  type DirectPositionDiscoveryParams,
  type PositionCandidateStorage,
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
    multicall: async ({ contracts }: { contracts: readonly { args: readonly [bigint] }[] }) => {
      calls.push('ownerOfBatch');
      return contracts.map(({ args }) => {
        const id = Number(args[0]);
        return owned.has(id)
          ? { status: 'success', result: wallet }
          : { status: 'failure', error: new Error('burned or foreign') };
      });
    },
  } as DirectPositionDiscoveryParams['client'] & { calls: string[] };
}

function mockStorage(initial?: string): PositionCandidateStorage & { value: string | null } {
  const storage = {
    value: initial ?? null,
    getItem(key: string) { return key === DIRECT_POSITION_CANDIDATE_SESSION_KEY ? this.value : null; },
    setItem(key: string, value: string) { if (key === DIRECT_POSITION_CANDIDATE_SESSION_KEY) this.value = value; },
  };
  return storage;
}

test('complete verified indexer coverage avoids a direct scan', async () => {
  const client = mockClient({ balance: 1n, ownedIds: [7] });
  const result = await discoverDirectWalletPositionIds({
    client,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [7],
    memoryCandidates: new Map(),
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
    memoryCandidates: new Map(),
  });
  assert.deepEqual(result, { ids: [7], expectedCount: 1n, usedScan: true });
  assert.equal(client.calls.filter((call) => call === 'getNextPositionId').length, 1);
});

test('historical scans search newest IDs first without claiming partial coverage', async () => {
  const newestId = 1999;
  const client = mockClient({ balance: 1n, nextId: BigInt(newestId + 1), ownedIds: [newestId] });
  const result = await discoverDirectWalletPositionIds({
    client, group, walletAddress: wallet, verifiedIndexerIds: [], memoryCandidates: new Map(),
  });
  assert.deepEqual(result.ids, [newestId]);
  assert.equal(client.calls.filter((call) => call === 'ownerOfBatch').length, 2, 'latest ID is checked in the first pair of bounded batches');
});

test('a wallet-scoped candidate cache rechecks ownership and recovers a transferred NFT', async () => {
  const first = mockClient({ balance: 1n, nextId: 8n, ownedIds: [7] });
  const memoryCandidates = new Map<string, number[]>();
  await discoverDirectWalletPositionIds({ client: first, group, walletAddress: wallet, verifiedIndexerIds: [], memoryCandidates });
  const repeat = mockClient({ balance: 1n, nextId: BigInt(DIRECT_POSITION_SCAN_MAX_IDS + 1), ownedIds: [7] });
  const repeated = await discoverDirectWalletPositionIds({ client: repeat, group, walletAddress: wallet, verifiedIndexerIds: [], memoryCandidates });
  assert.deepEqual(repeated.ids, [7]);
  assert.equal(repeat.calls.includes('getNextPositionId'), false, 'healthy cached candidates avoid a full range scan');
  const transferred = mockClient({ balance: 1n, nextId: 10n, ownedIds: [8] });
  const result = await discoverDirectWalletPositionIds({ client: transferred, group, walletAddress: wallet, verifiedIndexerIds: [], memoryCandidates });
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
    memoryCandidates: new Map(),
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
    memoryCandidates: new Map(),
  }), /exceeds/);

  const incomplete = mockClient({ balance: 1n, nextId: 4n, ownedIds: [] });
  await assert.rejects(() => discoverDirectWalletPositionIds({
    client: incomplete,
    group,
    walletAddress: wallet,
    verifiedIndexerIds: [],
    memoryCandidates: new Map(),
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

test('session candidate IDs survive a reload but ownership and balance remain authoritative', async () => {
  const storage = mockStorage();
  const first = mockClient({ balance: 1n, ownedIds: [7] });
  await discoverDirectWalletPositionIds({
    client: first, group, walletAddress: wallet, verifiedIndexerIds: [7],
    candidateStorage: storage, memoryCandidates: new Map(),
  });
  assert.deepEqual(parsePositionCandidateCache(storage.value)?.[0]?.ids, [7]);

  // A new in-memory map models a full page reload; the session candidate still
  // avoids historical enumeration after a fresh balanceOf and ownerOf check.
  const reloaded = mockClient({ balance: 1n, nextId: BigInt(DIRECT_POSITION_SCAN_MAX_IDS + 1), ownedIds: [7] });
  const fromSession = await discoverDirectWalletPositionIds({
    client: reloaded, group, walletAddress: wallet, verifiedIndexerIds: [],
    candidateStorage: storage, memoryCandidates: new Map(),
  });
  assert.deepEqual(fromSession.ids, [7]);
  assert.equal(reloaded.calls.includes('getNextPositionId'), false);
  assert.ok(reloaded.calls.includes('ownerOfBatch'), 'cached IDs still receive canonical ownerOf verification');

  // Same balance count is not enough: a transferred candidate fails ownerOf,
  // is discarded, and the canonical scan finds the replacement NFT.
  const transferred = mockClient({ balance: 1n, nextId: 9n, ownedIds: [8] });
  const afterTransfer = await discoverDirectWalletPositionIds({
    client: transferred, group, walletAddress: wallet, verifiedIndexerIds: [],
    candidateStorage: storage, memoryCandidates: new Map(),
  });
  assert.deepEqual(afterTransfer.ids, [8]);
  assert.ok(transferred.calls.includes('getNextPositionId'));
});

test('cached candidates with a count deficit cannot hide newly discovered NFTs', async () => {
  const storage = mockStorage();
  const cache = new Map<string, number[]>();
  const first = mockClient({ balance: 1n, ownedIds: [7] });
  await discoverDirectWalletPositionIds({ client: first, group, walletAddress: wallet, verifiedIndexerIds: [7], candidateStorage: storage, memoryCandidates: cache });

  const twoOwned = mockClient({ balance: 2n, nextId: 10n, ownedIds: [7, 9] });
  const refreshed = await discoverDirectWalletPositionIds({ client: twoOwned, group, walletAddress: wallet, verifiedIndexerIds: [], candidateStorage: storage, memoryCandidates: new Map() });
  assert.deepEqual(refreshed.ids, [7, 9]);
  assert.ok(twoOwned.calls.includes('getNextPositionId'), 'count mismatch forces a complete scan');
});

test('candidate storage failure leaves direct scan fail-closed and functional', async () => {
  const storage: PositionCandidateStorage = {
    getItem: () => { throw new Error('storage denied'); },
    setItem: () => { throw new Error('storage denied'); },
  };
  const client = mockClient({ balance: 1n, nextId: 9n, ownedIds: [7] });
  const result = await discoverDirectWalletPositionIds({
    client, group, walletAddress: wallet, verifiedIndexerIds: [],
    candidateStorage: storage, memoryCandidates: new Map(),
  });
  assert.deepEqual(result.ids, [7]);
  assert.ok(client.calls.includes('getNextPositionId'));
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

test('verified indexer fast paths keep the in-memory candidate cache bounded', async () => {
  const memoryCandidates = new Map<string, number[]>();
  for (let index = 1; index <= DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES + 1; index += 1) {
    const walletAddress = `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`;
    await discoverDirectWalletPositionIds({
      client: mockClient({ balance: 1n, ownedIds: [7] }), group, walletAddress,
      verifiedIndexerIds: [7], expectedCount: 1n, memoryCandidates,
    });
  }
  assert.equal(memoryCandidates.size, DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES);
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
