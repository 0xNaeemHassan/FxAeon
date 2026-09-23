import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, toEventSelector, type Address, type Hex, type TransactionReceipt } from 'viem';
import { loadProtocolPositionHistory } from '../src/lib/protocolPositionHistory';
import type { FxPublicClient } from '../src/lib/fx/types';
import { createWalletReadScope } from '../src/lib/walletDataRefresh';

const wallet = '0x930FEAE1B277FF60B836D2cE27f162555A5B98b9' as Address;
const hash = `0x${'7'.repeat(64)}` as Hex;
const syntheticWallet = '0x1111111111111111111111111111111111111111' as Address;
const blockHash = `0x${'a'.repeat(64)}` as Hex;
const pool = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8' as Address;
const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708' as Address;
const closeTopic = toEventSelector('event CloseOrRemove(address pool,uint256 position,address recipient,uint256 colls,uint256 debts,uint256 borrows)');

function testHash(digit: string): Hex {
  return `0x${digit.repeat(64)}` as Hex;
}

function successfulReceipt(
  recipient: Address = wallet,
  positionIds: number[] = [2004],
  transactionHash: Hex = hash,
): TransactionReceipt {
  return {
    status: 'success',
    transactionHash,
    blockNumber: 100n,
    blockHash,
    logs: positionIds.map((positionId, index) => ({
      address: router,
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [pool, BigInt(positionId), recipient, 1n, 2n, 3n],
      ),
      topics: [closeTopic],
      blockNumber: 100n,
      blockHash,
      transactionHash,
      logIndex: index + 1,
      removed: false,
    })),
  } as unknown as TransactionReceipt;
}

function fakeClient(receipt: TransactionReceipt | Map<Hex, TransactionReceipt>): FxPublicClient {
  return {
    chain: { id: 1 },
    getChainId: async () => 1,
    getTransactionReceipt: async ({ hash: requestedHash }: { hash: Hex }) => {
      if (receipt instanceof Map) {
        const matchedReceipt = receipt.get(requestedHash.toLowerCase() as Hex);
        if (!matchedReceipt) throw new Error('No synthetic receipt for requested hash.');
        return matchedReceipt;
      }
      return receipt;
    },
  } as unknown as FxPublicClient;
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetcher(options: { recipient?: Address; includePosition?: boolean } = {}) {
  const requests: Array<{ url: string; query: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { query: string };
    requests.push({ url, query: payload.query });
    const isEthLong = url.includes('/fx-v2-wsteth/3.0.0/');
    const isPositionQuery = payload.query.includes('WalletPositionHistory');
    const data = isPositionQuery
      ? { positions: isEthLong && options.includePosition !== false ? [{ id: '2004', isClosed: true, blockNumber: '100' }] : [] }
      : { orders: isEthLong && options.includePosition !== false ? [{ positionId: '2004', type: 'Close', hash, blockNumber: '100', timestamp: '1700000000' }] : [] };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, requests };
}

test('loads closed protocol positions for the connected wallet and verifies the exact router receipt', async () => {
  const { fetcher, requests } = fakeFetcher();
  let receiptReads = 0;
  const client = fakeClient(successfulReceipt());
  client.getTransactionReceipt = async () => { receiptReads += 1; return successfulReceipt(); };

  const result = await loadProtocolPositionHistory({ walletAddress: wallet, client, fetcher });

  assert.equal(result.items.length, 1, 'duplicate index rows collapse by chain and transaction hash');
  assert.equal(result.items[0].kind, 'close');
  assert.equal(result.items[0].positionId, 2004);
  assert.equal(result.items[0].hash, hash);
  assert.equal(receiptReads, 1);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ query }) => query.includes(wallet.toLowerCase()) || query.includes('positionId_in:')));
  assert.ok(requests.some(({ query }) => query.includes('realOwner')));
});

test('does not present an indexed close when the receipt event names another recipient', async () => {
  const { fetcher } = fakeFetcher();
  const result = await loadProtocolPositionHistory({
    walletAddress: wallet,
    client: fakeClient(successfulReceipt('0x0000000000000000000000000000000000000001')),
    fetcher,
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.partial, true);
});

test('queries an arbitrary second wallet and verifies its matching receipt', async () => {
  const candidateHash = testHash('8');
  const requests: Array<{ url: string; query: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    requests.push({ url, query });
    if (!url.includes('/fx-v2-wsteth/3.0.0/')) return jsonResponse({ positions: [], orders: [] });
    return query.includes('WalletPositionHistory')
      ? jsonResponse({ positions: [{ id: '305', isClosed: true, blockNumber: '100' }] })
      // Mirrors Goldsky's actual Order entity: ID encodes position ID + hash,
      // while a selected `positionId` property is absent from returned records.
      : jsonResponse({ orders: [{ id: `305_${candidateHash}`, type: 'Close', hash: candidateHash, blockNumber: '100', timestamp: '1700000000' }] });
  }) as typeof fetch;

  const result = await loadProtocolPositionHistory({
    walletAddress: syntheticWallet,
    client: fakeClient(new Map([[candidateHash, successfulReceipt(syntheticWallet, [305], candidateHash)]])),
    fetcher,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].positionId, 305);
  assert.equal(result.items[0].hash, candidateHash);
  assert.ok(requests.some(({ query }) => query.includes(syntheticWallet.toLowerCase())));
  assert.ok(requests.every(({ query }) => !query.includes(wallet.toLowerCase())));
  assert.ok(requests.some(({ query }) => query.includes('{ id type hash blockNumber timestamp }')));
});

test('keeps multiple position events from one transaction as distinct rows', async () => {
  const { fetcher } = fakeFetcher();
  const twoPositionFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { query: string };
    if (!url.includes('/fx-v2-wsteth/3.0.0/')) return fetcher(input, init);
    const data = payload.query.includes('WalletPositionHistory')
      ? { positions: [2004, 2005].map((id) => ({ id: String(id), isClosed: true, blockNumber: '100' })) }
      : { orders: [2004, 2005].map((positionId) => ({ positionId: String(positionId), type: 'Close', hash, blockNumber: '100', timestamp: '1700000000' })) };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;

  const result = await loadProtocolPositionHistory({ walletAddress: wallet, client: fakeClient(successfulReceipt(wallet, [2004, 2005])), fetcher: twoPositionFetcher });

  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.positionId), [2004, 2005]);
  assert.equal(result.items[0].hash, result.items[1].hash);
});

test('paginates indexed positions without an unbounded history scan', async () => {
  const { fetcher } = fakeFetcher({ includePosition: false });
  const manyPositionsFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { query: string };
    if (url.includes('/fx-v2-wsteth/3.0.0/') && payload.query.includes('WalletPositionHistory') && payload.query.includes('skip: 0')) {
      const positions = Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1), isClosed: false, blockNumber: '100' }));
      return new Response(JSON.stringify({ data: { positions } }), { status: 200 });
    }
    return fetcher(input, init);
  }) as typeof fetch;

  const result = await loadProtocolPositionHistory({ walletAddress: wallet, client: fakeClient(successfulReceipt()), fetcher: manyPositionsFetcher });

  assert.equal(result.hasMore, true);
  assert.equal(result.cursor[0].positions, 25);
  assert.deepEqual(result.cursor.slice(1), Array.from({ length: 3 }, () => ({ positions: -1, orders: -1 })));
});

test('advances actual order pages by five and resumes at the next order offset', async () => {
  const requests: Array<{ url: string; query: string }> = [];
  const makeOrders = (firstId: number) => Array.from({ length: 5 }, (_, index) => {
    const positionId = firstId + index;
    return {
      positionId: String(positionId), type: 'Close', hash: testHash(String(positionId % 10)),
      blockNumber: '100', timestamp: '1700000000',
    };
  });
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    requests.push({ url, query });
    if (!url.includes('/fx-v2-wsteth/3.0.0/')) return jsonResponse({ positions: [], orders: [] });
    if (query.includes('WalletPositionHistory')) {
      return jsonResponse({ positions: Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1), isClosed: false, blockNumber: '100' })) });
    }
    const skip = Number(query.match(/skip: (\d+)/)?.[1] ?? 0);
    return jsonResponse({ orders: makeOrders(skip + 1) });
  }) as typeof fetch;
  const receipts = new Map<Hex, TransactionReceipt>();
  for (let positionId = 1; positionId <= 10; positionId += 1) {
    const candidateHash = testHash(String(positionId % 10));
    receipts.set(candidateHash, successfulReceipt(syntheticWallet, [positionId], candidateHash));
  }

  const firstPage = await loadProtocolPositionHistory({ walletAddress: syntheticWallet, client: fakeClient(receipts), fetcher });
  const nextPage = await loadProtocolPositionHistory({ walletAddress: syntheticWallet, client: fakeClient(receipts), fetcher, cursor: firstPage.cursor });

  assert.ok(requests.some(({ query }) => query.includes('WalletPositionOrders') && query.includes('skip: 0')));
  assert.ok(requests.some(({ query }) => query.includes('WalletPositionOrders') && query.includes('skip: 5')));
  assert.deepEqual(firstPage.cursor[0], { positions: 0, orders: 5 });
  assert.deepEqual(nextPage.cursor[0], { positions: 0, orders: 10 });
  assert.equal(firstPage.items.length, 5);
  assert.equal(nextPage.items.length, 5);
});

test('marks activity partial when one of multiple same-transaction events is verified but another transaction is missing', async () => {
  const firstHash = testHash('8');
  const secondHash = testHash('9');
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/fx-v2-wsteth/3.0.0/')) return jsonResponse({ positions: [], orders: [] });
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    return query.includes('WalletPositionHistory')
      ? jsonResponse({ positions: [901, 902, 903].map((id) => ({ id: String(id), isClosed: true, blockNumber: '100' })) })
      : jsonResponse({ orders: [
        { positionId: '901', type: 'Close', hash: firstHash, blockNumber: '100', timestamp: '1700000000' },
        { positionId: '902', type: 'Close', hash: firstHash, blockNumber: '100', timestamp: '1700000000' },
        { positionId: '903', type: 'Close', hash: secondHash, blockNumber: '100', timestamp: '1700000000' },
      ] });
  }) as typeof fetch;
  const receipts = new Map<Hex, TransactionReceipt>([
    [firstHash, successfulReceipt(syntheticWallet, [901, 902], firstHash)],
    [secondHash, successfulReceipt('0x2222222222222222222222222222222222222222', [903], secondHash)],
  ]);

  const result = await loadProtocolPositionHistory({ walletAddress: syntheticWallet, client: fakeClient(receipts), fetcher });

  assert.deepEqual(result.items.map((item) => item.positionId), [901, 902]);
  assert.equal(result.items[0].hash, result.items[1].hash);
  assert.equal(result.partial, true);
});

test('a StrictMode-style cleanup replay lets only the new history read publish', async () => {
  const scope = createWalletReadScope(wallet);
  scope.select(wallet);
  const committed: string[] = [];
  let finishFirst!: (value: string) => void;
  let finishSecond!: (value: string) => void;
  const first = new Promise<string>((resolve) => { finishFirst = resolve; });
  const second = new Promise<string>((resolve) => { finishSecond = resolve; });
  const startEffectRead = (promise: Promise<string>) => {
    const isCurrent = scope.start(wallet);
    assert.ok(isCurrent);
    void promise.then((value) => { if (isCurrent()) committed.push(value); });
    return () => scope.cancel();
  };

  const cleanupFirst = startEffectRead(first);
  cleanupFirst();
  startEffectRead(second);
  finishFirst('cancelled mount');
  finishSecond('replayed mount');
  await Promise.all([first, second]);
  await Promise.resolve();

  assert.deepEqual(committed, ['replayed mount']);
});

test('keeps a failed market cursor retryable when another index succeeds', async () => {
  const { fetcher } = fakeFetcher({ includePosition: false });
  let failedOnce = false;
  const transientFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/fx-v2-wbtc/3.0.0/') && !failedOnce) {
      failedOnce = true;
      return new Response('unavailable', { status: 503 });
    }
    return fetcher(input, init);
  }) as typeof fetch;

  const firstPage = await loadProtocolPositionHistory({ walletAddress: syntheticWallet, client: fakeClient(successfulReceipt(syntheticWallet)), fetcher: transientFetcher });

  assert.equal(firstPage.partial, true);
  assert.deepEqual(firstPage.cursor[1], { positions: 0, orders: 0 });
  const retryPage = await loadProtocolPositionHistory({ walletAddress: syntheticWallet, client: fakeClient(successfulReceipt(syntheticWallet)), fetcher: transientFetcher, cursor: firstPage.cursor });
  assert.deepEqual(retryPage.cursor[1], { positions: -1, orders: -1 });
});
