import assert from 'node:assert/strict';
import test from 'node:test';
import { createPriceRefreshCoordinator } from '../src/components/PriceProvider';

test('overlapping price refreshes share and await the same request', async () => {
  const states: boolean[] = [];
  const coordinator = createPriceRefreshCoordinator((refreshing) => states.push(refreshing));
  let release!: () => void;
  let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = coordinator.run(undefined, async () => { calls += 1; await gate; });
  const second = coordinator.run(undefined, async () => { calls += 1_000; });

  assert.strictEqual(second, first);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(states, [true]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(states, [true, false]);
});

test('a replacement after abort owns refreshing state until it settles', async () => {
  const states: boolean[] = [];
  const coordinator = createPriceRefreshCoordinator((refreshing) => states.push(refreshing));
  const oldController = new AbortController();
  let releaseOld!: () => void;
  let releaseCurrent!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const currentGate = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  let oldIsCurrent: (() => boolean) | undefined;
  const old = coordinator.run(oldController.signal, async (isCurrent) => { oldIsCurrent = isCurrent; await oldGate; });
  await Promise.resolve();
  oldController.abort();
  const current = coordinator.run(undefined, async () => { await currentGate; });
  assert.notStrictEqual(current, old);
  await Promise.resolve();
  releaseOld();
  await old;
  assert.equal(oldIsCurrent?.(), false);
  assert.deepEqual(states, [true, true]);
  releaseCurrent();
  await current;
  assert.deepEqual(states, [true, true, false]);
});

test('failed refresh work settles and clears its in-flight marker', async () => {
  const states: boolean[] = [];
  const coordinator = createPriceRefreshCoordinator((refreshing) => states.push(refreshing));
  await assert.rejects(coordinator.run(undefined, async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(states, [true, false]);
  await coordinator.run(undefined, async () => undefined);
  assert.deepEqual(states, [true, false, true, false]);
});
