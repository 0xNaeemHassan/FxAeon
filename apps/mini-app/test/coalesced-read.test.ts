import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoalescedReadCache } from '../src/lib/coalescedRead';

test('coalesces concurrent reads and caches successful results', async () => {
  const cache = createCoalescedReadCache<number>();
  let calls = 0;
  let resolve: ((value: number) => void) | undefined;
  const loader = () => {
    calls += 1;
    return new Promise<number>((next) => { resolve = next; });
  };
  const first = cache.read('ETH:1D', loader);
  const second = cache.read('ETH:1D', loader);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  resolve?.(42);
  assert.equal(await first, 42);
  assert.equal(cache.getFresh('ETH:1D', Date.now(), 90_000), 42);
  assert.equal(await cache.read('ETH:1D', async () => { calls += 1; return 99; }), 99);
  assert.equal(calls, 2, 'read callers consult freshness before invoking the loader');
});

test('failed reads clear the in-flight slot so retry can recover', async () => {
  const cache = createCoalescedReadCache<number>();
  let calls = 0;
  const first = cache.read('BTC:1D', async () => {
    calls += 1;
    throw new Error('offline');
  });
  await assert.rejects(first, /offline/);
  const recovered = cache.read('BTC:1D', async () => {
    calls += 1;
    return 7;
  });
  assert.equal(await recovered, 7);
  assert.equal(calls, 2);
});
