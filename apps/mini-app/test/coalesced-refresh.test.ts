import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoalescedRefresh } from '../src/lib/coalescedRefresh';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('coalesces visibility and interval refreshes while one request is pending', async () => {
  const result = deferred<{ value: string }>();
  let fetches = 0;
  let starts = 0;
  let settled = 0;
  const values: string[] = [];
  const errors: string[] = [];
  const refresh = createCoalescedRefresh({
    fetch: () => { fetches += 1; return result.promise; },
    onStart: () => { starts += 1; },
    onSuccess: (value) => { values.push(value.value); },
    onError: () => { errors.push('failed'); },
    onSettled: () => { settled += 1; },
  });

  const intervalRefresh = refresh.refresh();
  const visibilityRefresh = refresh.refresh();
  assert.strictEqual(visibilityRefresh, intervalRefresh);
  await Promise.resolve();
  assert.equal(fetches, 1);
  assert.equal(starts, 1);

  result.resolve({ value: 'latest' });
  await intervalRefresh;
  assert.deepEqual(values, ['latest']);
  assert.deepEqual(errors, []);
  assert.equal(settled, 1);

  refresh.dispose();
});

test('ignores completion after cleanup and permits a fresh StrictMode replay request', async () => {
  const previous = deferred<{ value: string }>();
  const replayed = deferred<{ value: string }>();
  const values: string[] = [];
  const errors: string[] = [];
  let previousSettled = 0;
  let replayedSettled = 0;
  const firstMount = createCoalescedRefresh({
    fetch: () => previous.promise,
    onStart: () => {},
    onSuccess: (value) => { values.push(`old:${value.value}`); },
    onError: () => { errors.push('old'); },
    onSettled: () => { previousSettled += 1; },
  });
  const abandonedRequest = firstMount.refresh();
  firstMount.dispose();

  const replayedMount = createCoalescedRefresh({
    fetch: () => replayed.promise,
    onStart: () => {},
    onSuccess: (value) => { values.push(`new:${value.value}`); },
    onError: () => { errors.push('new'); },
    onSettled: () => { replayedSettled += 1; },
  });
  const currentRequest = replayedMount.refresh();
  replayed.resolve({ value: 'success' });
  await currentRequest;
  previous.reject(new Error('late failure from cleaned-up mount'));
  await abandonedRequest;

  assert.deepEqual(values, ['new:success']);
  assert.deepEqual(errors, []);
  assert.equal(previousSettled, 0);
  assert.equal(replayedSettled, 1);
  replayedMount.dispose();
});
