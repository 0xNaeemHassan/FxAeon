import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cachedActivityCall,
  clearActivityCallsForTests,
  loadActivityCalls,
  uncachedActivityCalls,
  type ActivityCallDependencies,
} from '../src/lib/activityCalls';

const wallet = '0x1111111111111111111111111111111111111111';
const router = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const urls = (chainId: 1 | 8453) => [
  `https://${chainId === 1 ? 'eth-mainnet' : 'base-mainnet'}.g.alchemy.com/v2/primary`,
  `https://${chainId === 1 ? 'mainnet' : 'base-mainnet'}.infura.io/v3/project`,
];
type Batch = Array<{ jsonrpc: string; id: number; method: string; params: [string] }>;

function transaction(txHash: string, overrides: Record<string, unknown> = {}) {
  return { hash: txHash, from: wallet, to: router, input: '0xef9e1aa700', value: '0x0', nonce: '0x1', ...overrides };
}

function deps(fetcher: ActivityCallDependencies['fetcher']): ActivityCallDependencies {
  return { fetcher, getRpcUrls: urls };
}

test.beforeEach(() => clearActivityCallsForTests());

test('reads calldata with one eth_getTransactionByHash batch per chain from Alchemy only', async () => {
  const requests: Array<{ url: string; batch: Batch }> = [];
  const result = await loadActivityCalls([
    { chainId: 1, hash: hash('a') }, { chainId: 1, hash: hash('b') }, { chainId: 8453, hash: hash('c') }, { chainId: 1, hash: hash('a') },
  ], deps(async (input, init) => {
    const batch = JSON.parse(String(init?.body)) as Batch;
    requests.push({ url: String(input), batch });
    return { ok: true, json: async () => batch.map((request) => ({ jsonrpc: '2.0', id: request.id, result: transaction(request.params[0], { value: '0x10' }) })) } as Response;
  }));
  assert.equal(result.partial, false);
  assert.equal(requests.length, 2);
  for (const { url, batch } of requests) {
    assert.match(url, /\.g\.alchemy\.com\/v2\/primary$/);
    assert.ok(batch.every((request) => request.method === 'eth_getTransactionByHash'));
  }
  assert.deepEqual(requests.find(({ url }) => url.includes('eth-mainnet'))!.batch.map((request) => request.params[0]), [hash('a'), hash('b')]);
  const call = cachedActivityCall(1, hash('a').toUpperCase().replace('0X', '0x'));
  assert.deepEqual(call, { from: wallet, to: router, input: '0xef9e1aa700', value: 16n });
  // Cached hashes are never requested again.
  assert.deepEqual(uncachedActivityCalls([{ chainId: 1, hash: hash('a') }, { chainId: 1, hash: hash('d') }]), [{ chainId: 1, hash: hash('d') }]);
});

test('failures and malformed items stay uncached so a retry can read them', async () => {
  const result = await loadActivityCalls([{ chainId: 1, hash: hash('a') }, { chainId: 1, hash: hash('b') }, { chainId: 1, hash: hash('e') }], deps(async (_input, init) => {
    const batch = JSON.parse(String(init?.body)) as Batch;
    return { ok: true, json: async () => [
      { jsonrpc: '2.0', id: batch[0].id, result: transaction(hash('f')) },
      { jsonrpc: '2.0', id: batch[1].id, error: { code: 429, message: 'rate limited' } },
      { jsonrpc: '2.0', id: batch[2].id, result: null },
    ] } as Response;
  }));
  assert.equal(result.partial, true);
  assert.equal(cachedActivityCall(1, hash('a')), undefined, 'a result for another hash is rejected');
  assert.equal(cachedActivityCall(1, hash('b')), undefined, 'an item error is not cached');
  assert.equal(cachedActivityCall(1, hash('e')), null, 'an unknown transaction is remembered as unknown');

  const timedOut = await loadActivityCalls([{ chainId: 8453, hash: hash('a') }], { ...deps(async () => new Promise<Response>(() => {})), timeoutMs: 5 });
  assert.equal(timedOut.partial, true);
  assert.equal(cachedActivityCall(8453, hash('a')), undefined);
});

test('no configured Alchemy endpoint means no request and an unclassified result', async () => {
  let called = false;
  const result = await loadActivityCalls([{ chainId: 1, hash: hash('a') }], { fetcher: async () => { called = true; return new Response('[]'); }, getRpcUrls: () => { throw new Error('missing'); } });
  assert.equal(called, false);
  assert.equal(result.partial, true);
});
