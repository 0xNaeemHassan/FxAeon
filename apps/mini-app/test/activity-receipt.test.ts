import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Hex } from 'viem';
import { loadActivityReceipt } from '../src/lib/activityReceipt';
const hash = `0x${'11'.repeat(32)}` as Hex;
const receipt = { transactionHash: hash, blockHash: `0x${'22'.repeat(32)}`, blockNumber: 12n,
  status: 'success', gasUsed: 123456n, effectiveGasPrice: 987654321n };
function client(overrides: Record<string, unknown> = {}) {
  return { getChainId: async () => 1, getBlockNumber: async () => 13n,
    getTransactionReceipt: async () => receipt, ...overrides } as never;
}
test('activity cost uses receipt gas used and effective price for successful and reverted transactions', async () => {
  assert.deepEqual(await loadActivityReceipt(1, hash, client()), { status: 'confirmed', executionCost: 123456n * 987654321n });
  assert.equal((await loadActivityReceipt(1, hash, client({ getTransactionReceipt: async () => ({ ...receipt, status: 'reverted' }) }))).status, 'failed');
});
test('activity receipt rejects wrong chain, hash, unknown status, invalid cost and insufficient confirmations', async () => {
  for (const change of [{ getChainId: async () => 8453 }, { getBlockNumber: async () => 12n },
    ...[{ transactionHash: '0x1234' }, { status: undefined }, { gasUsed: -1n }, { effectiveGasPrice: undefined }]
      .map(change => ({ getTransactionReceipt: async () => ({ ...receipt, ...change }) }))]) {
    await assert.rejects(loadActivityReceipt(1, hash, client(change)));
  }
});
test('a changed block or status during receipt verification cannot produce a final cost', async () => {
  for (const change of [{ blockHash: '0x1234' }, { blockNumber: 13n }, { status: 'reverted' }]) {
    let reads = 0;
    await assert.rejects(loadActivityReceipt(1, hash, client({ getTransactionReceipt: async () => ++reads === 1 ? receipt : { ...receipt, ...change } })), /Receipt changed/);
  }
});
