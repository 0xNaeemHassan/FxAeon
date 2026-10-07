import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Call = { id: number };
type Client = { multicall: (args: { contracts: Call[] }) => Promise<unknown[]> };
type Batch = (client: Client, calls: Call[], batchSize?: number, delayMs?: number) => Promise<unknown[]>;
const sdkDist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');

function installedBatch(bundle: 'index.js' | 'index.cjs'): Batch {
  const source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  const start = source.indexOf('var MULTICALL_BATCH_SIZE = ');
  const end = source.indexOf('// src/core/aggregators/index.ts', start);
  assert.ok(start >= 0 && end > start, 'expected installed SDK multicall helper');
  // Execute the installed helper, not a test reimplementation or patch text.
  return new Function(`${source.slice(start, end)}\nreturn batchedMulticall;`)() as Batch;
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

for (const bundle of ['index.js', 'index.cjs'] as const) {
  test(`installed ${bundle} returns a single batch without an idle tail`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let completed = false;
    const calls = [{ id: 1 }, { id: 2 }];
    const expected = [{ status: 'success', result: 42n }, { status: 'failure' }];
    const pending = installedBatch(bundle)({ multicall: async ({ contracts }) => {
      assert.deepEqual(contracts, calls);
      return expected;
    } }, calls).then(result => { completed = true; return result; });
    await flush();
    assert.equal(completed, true, 'completed reads must not wait 500ms before returning');
    assert.deepEqual(await pending, expected);
  });

  test(`installed ${bundle} preserves 500ms between chunks and preserves result order`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = Array.from({ length: 101 }, (_, id) => ({ id }));
    const batches: number[][] = [];
    let completed = false;
    const pending = installedBatch(bundle)({ multicall: async ({ contracts }) => {
      batches.push(contracts.map(call => call.id));
      return contracts.map(call => ({ status: 'success', result: call.id }));
    } }, calls).then(result => { completed = true; return result; });
    await flush();
    assert.deepEqual(batches.map(batch => batch.length), [50]);
    t.mock.timers.tick(499); await flush();
    assert.equal(batches.length, 1);
    t.mock.timers.tick(1); await flush();
    assert.deepEqual(batches.map(batch => batch.length), [50, 50]);
    assert.equal(completed, false);
    t.mock.timers.tick(500); await flush();
    assert.deepEqual(batches.map(batch => batch.length), [50, 50, 1]);
    assert.equal(completed, true, 'the final chunk adds no third sleep');
    assert.deepEqual(await pending, calls.map(call => ({ status: 'success', result: call.id })));
  });

  test(`installed ${bundle} preserves failed chunk placeholders and continues only after the delay`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let count = 0;
    const pending = installedBatch(bundle)({ multicall: async ({ contracts }) => {
      count++;
      if (count === 1) throw new Error('mock upstream unavailable');
      return contracts.map(call => call.id);
    } }, [{ id: 1 }, { id: 2 }, { id: 3 }], 2, 500);
    await flush();
    assert.equal(count, 1);
    t.mock.timers.tick(500); await flush();
    assert.equal(count, 2);
    assert.deepEqual(await pending, [undefined, undefined, 3]);
  });

  test(`installed ${bundle} returns an empty input without any RPC or timer`, async () => {
    assert.deepEqual(await installedBatch(bundle)({ multicall: async () => { throw new Error('must not call'); } }, []), []);
  });
}
