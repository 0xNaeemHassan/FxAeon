import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecoveryViewModel } from '../src/lib/fx/recovery';
import type { PlannedRoute, TransactionExecutionResult, TransactionStepResult } from '../src/lib/fx/types';
import {
  createRecoveryWalletRefresh,
  createRouteWalletRefresh,
  createWalletReadScope,
  includedRouteWalletScope,
  verifiedRecoveryWalletRefreshes,
} from '../src/lib/walletDataRefresh';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x3333333333333333333333333333333333333333';
const TARGET = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'a'.repeat(64)}` as const;
const SECOND_HASH = `0x${'b'.repeat(64)}` as const;
type Receipt = NonNullable<TransactionStepResult['receipt']>;

function route(chainId: 1 | 8453 = 1): PlannedRoute {
  return {
    operation: 'increasePosition', chainId, walletAddress: WALLET,
    transactions: [{ chainId, from: WALLET, to: TARGET, data: '0x12345678', value: 0n, kind: 'action', operation: 'increasePosition' }],
  };
}

function result(reviewed = route(), receiptOverrides: Partial<Receipt> = {}): TransactionExecutionResult {
  return {
    status: 'confirmed', operation: reviewed.operation, chainId: reviewed.chainId, walletAddress: reviewed.walletAddress,
    steps: [{
      index: 0, transaction: { ...reviewed.transactions[0] }, hash: HASH, status: 'confirmed',
      receipt: { status: 'success', transactionHash: HASH, from: WALLET, to: TARGET, blockNumber: 100n, ...receiptOverrides } as Receipt,
    }],
  };
}

function recovered(overrides: Partial<RecoveryViewModel> = {}): RecoveryViewModel {
  return {
    record: {
      id: 'pending-one', operation: 'increasePosition', walletAddress: WALLET, chainId: 1, hash: HASH,
      to: TARGET, submittedAt: 1, status: 'pending', nonce: 1, valueWei: '0', dataHash: HASH,
    },
    status: 'confirmed', verification: 'receipt', receiptBlockNumber: 100n,
    explorerUrl: `https://etherscan.io/tx/${HASH}`, message: 'Confirmed on-chain', ...overrides,
  };
}

test('wallet signatures, broadcast hashes, and claimed result status alone never authorize refresh', () => {
  for (const status of ['confirmed', 'partial', 'failed'] as const) {
    const execution = result();
    execution.status = status;
    execution.steps[0].receipt = undefined;
    assert.equal(includedRouteWalletScope(route(), execution), null);
    execution.steps[0].hash = undefined;
    assert.equal(includedRouteWalletScope(route(), execution), null);
  }
});

test('included success and revert receipts refresh the captured wallet on either supported chain', () => {
  for (const chainId of [1, 8453] as const) {
    const reviewed = route(chainId);
    for (const status of ['success', 'reverted'] as const) {
      const execution = result(reviewed, { status });
      if (status === 'reverted') { execution.status = 'failed'; execution.steps[0].status = 'failed'; }
      assert.deepEqual(includedRouteWalletScope(reviewed, execution), { address: WALLET, chainId });
    }
  }
});

test('a confirmed approval followed by a declined action still refreshes included gas and allowance changes', () => {
  const reviewed = route();
  reviewed.transactions.unshift({ ...reviewed.transactions[0], kind: 'approval', type: 'approveToken' });
  const execution = result(reviewed);
  execution.status = 'partial';
  execution.steps.push({ index: 1, transaction: reviewed.transactions[1], status: 'failed', error: 'User declined' });
  assert.deepEqual(includedRouteWalletScope(reviewed, execution), { address: WALLET, chainId: 1 });
});

test('refresh does not claim the action succeeded when inclusion is known but later verification failed', () => {
  const execution = result();
  execution.status = 'failed';
  execution.steps[0].status = 'failed';
  execution.steps[0].error = 'Mined calldata verification unavailable';
  assert.deepEqual(includedRouteWalletScope(route(), execution), { address: WALLET, chainId: 1 });
  assert.equal(execution.status, 'failed');
});

test('receipt identity, terminal status, and canonical block are required', () => {
  const invalidReceipts: Partial<Receipt>[] = [
    { transactionHash: SECOND_HASH }, { from: OTHER }, { to: OTHER }, { to: null },
    { from: 1 as unknown as Receipt['from'] }, { to: 1 as unknown as Receipt['to'] },
    { blockNumber: -1n }, { blockNumber: undefined }, { blockNumber: 100 as unknown as bigint },
    { status: undefined }, { status: 'pending' as Receipt['status'] },
  ];
  for (const invalid of invalidReceipts) assert.equal(includedRouteWalletScope(route(), result(route(), invalid)), null);
  const execution = result();
  execution.steps[0].hash = '0x1234';
  execution.steps[0].receipt!.transactionHash = '0x1234';
  assert.equal(includedRouteWalletScope(route(), execution), null);
});

test('execution and step must bind back to the reviewed account, chain, and exact transaction', () => {
  const mutations: ((execution: TransactionExecutionResult) => void)[] = [
    (execution) => { execution.walletAddress = OTHER; },
    (execution) => { execution.chainId = 8453; },
    (execution) => { execution.operation = 'depositFxSave'; },
    (execution) => { execution.steps[0].index = 1; },
    (execution) => { execution.steps[0].index = -1; },
    (execution) => { execution.steps[0].transaction.from = OTHER; },
    (execution) => { execution.steps[0].transaction.chainId = 8453; },
    (execution) => { execution.steps[0].transaction.to = OTHER; },
    (execution) => { execution.steps[0].transaction.data = '0x98765432'; },
    (execution) => { execution.steps[0].transaction.value = 1n; },
    (execution) => { execution.steps[0].transaction.nonce = 3; },
  ];
  for (const mutate of mutations) {
    const execution = result();
    mutate(execution);
    assert.equal(includedRouteWalletScope(route(), execution), null);
  }
});

test('normal post-confirm callback and returned-execution fallback join a single cache refresh', async () => {
  const calls: [string, number][] = [];
  const refresh = createRouteWalletRefresh(async (address, chainId) => { calls.push([address, chainId]); });
  const execution = result();
  const first = refresh(route(), execution);
  const second = refresh(route(), execution);
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(calls, [[WALLET, 1]]);
});

test('fallback alone refreshes partial or reverted executions even if postConfirmRead never ran', async () => {
  for (const status of ['partial', 'failed'] as const) {
    const calls: [string, number][] = [];
    const refresh = createRouteWalletRefresh(async (address, chainId) => { calls.push([address, chainId]); });
    const execution = result(route(), { status: 'reverted' });
    execution.status = status;
    execution.steps[0].status = 'failed';
    await refresh(route(), execution);
    assert.deepEqual(calls, [[WALLET, 1]]);
    assert.equal(execution.status, status);
  }
});

test('a no-receipt attempt does not suppress a later proven refresh; sync and async cache errors remain harmless', async () => {
  for (const invalidate of [() => { throw new Error('sync cache error'); }, async () => { throw new Error('RPC unavailable'); }]) {
    let calls = 0;
    const refresh = createRouteWalletRefresh((address, chainId) => {
      calls += 1;
      assert.deepEqual([address, chainId], [WALLET, 1]);
      return invalidate();
    });
    const submitted = result();
    submitted.steps[0].receipt = undefined;
    await refresh(route(), submitted);
    assert.equal(calls, 0);
    const execution = result();
    await assert.doesNotReject(refresh(route(), execution));
    await refresh(route(), execution);
    assert.equal(calls, 1);
    assert.equal(execution.status, 'confirmed');
  }
});

test('recovery status from local storage or an unverified view cannot trigger invalidation', () => {
  for (const verification of ['not-found', 'rpc-error', 'mismatch'] as const) {
    const view = recovered({ verification, status: 'pending' });
    view.record.status = 'confirmed';
    assert.deepEqual(verifiedRecoveryWalletRefreshes([view], WALLET, new Set()), []);
  }
  for (const invalid of [{ status: 'pending' as const }, { receiptBlockNumber: undefined }, { receiptBlockNumber: -1n }]) {
    assert.deepEqual(verifiedRecoveryWalletRefreshes([recovered(invalid)], WALLET, new Set()), []);
  }
  assert.deepEqual(verifiedRecoveryWalletRefreshes([recovered()], OTHER, new Set()), []);
  assert.deepEqual(verifiedRecoveryWalletRefreshes([recovered()], '', new Set()), []);
});

test('recovery groups included success and revert receipts by original chain and deduplicates repeated events', () => {
  const success = recovered();
  const reverted = recovered({ status: 'failed', record: { ...success.record, id: 'second', hash: SECOND_HASH } });
  const base = recovered({ record: { ...success.record, id: 'base', chainId: 8453 } });
  const views = [success, reverted, success, base];
  const batches = verifiedRecoveryWalletRefreshes(views, WALLET, new Set());
  assert.deepEqual(batches.map(({ address, chainId, receiptKeys }) => [address, chainId, receiptKeys.length]), [[WALLET, 1, 2], [WALLET, 8453, 1]]);
  const seen = new Set(batches.flatMap(({ receiptKeys }) => receiptKeys));
  assert.deepEqual(verifiedRecoveryWalletRefreshes(views, WALLET, seen), []);
  // A newly observed canonical receipt after a reorg is not the old event.
  assert.equal(verifiedRecoveryWalletRefreshes([{ ...success, receiptBlockNumber: 101n }], WALLET, seen).length, 1);
});

test('recovery scopes never follow the currently selected wallet or accept unsupported chains', () => {
  const view = recovered();
  assert.deepEqual(verifiedRecoveryWalletRefreshes([view], OTHER, new Set()), []);
  view.record.chainId = 10 as typeof view.record.chainId;
  assert.deepEqual(verifiedRecoveryWalletRefreshes([view], WALLET, new Set()), []);
  view.record.chainId = 1;
  view.record.hash = '0x1234';
  assert.deepEqual(verifiedRecoveryWalletRefreshes([view], WALLET, new Set()), []);
});

test('any recovery surface refreshes only authoritative receipts and deduplicates them', async () => {
  const calls: [string, number][] = [];
  const refresh = createRecoveryWalletRefresh(async (address, chainId) => { calls.push([address, chainId]); });
  await refresh([recovered(), recovered({ verification: 'not-found', status: 'pending' })], WALLET, () => true);
  await refresh([recovered()], WALLET, () => true);
  assert.deepEqual(calls, [[WALLET, 1]]);
});

test('a stale recovery response neither invalidates a new wallet nor consumes receipt dedupe', async () => {
  const calls: [string, number][] = [];
  const refresh = createRecoveryWalletRefresh(async (address, chainId) => { calls.push([address, chainId]); });
  await refresh([recovered()], WALLET, () => false);
  assert.deepEqual(calls, []);
  await refresh([recovered()], WALLET, () => true);
  assert.deepEqual(calls, [[WALLET, 1]]);
});

test('wallet read scope rejects overlapping and A-B-A stale responses', () => {
  const scope = createWalletReadScope(WALLET);
  const firstA = scope.start(WALLET)!;
  const secondA = scope.start(WALLET)!;
  assert.equal(firstA(), false);
  assert.equal(secondA(), true);
  scope.select(OTHER);
  assert.equal(secondA(), false);
  const readB = scope.start(OTHER)!;
  scope.select(WALLET);
  const currentA = scope.start(WALLET)!;
  assert.equal(readB(), false);
  assert.equal(firstA(), false);
  assert.equal(currentA(), true);
  scope.cancel();
  assert.equal(currentA(), false);
});
