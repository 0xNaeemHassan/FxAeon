import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecoveryViewModel } from '../src/lib/fx/recovery';
import type { PendingHashRecord } from '../src/lib/fx/types';
import {
  clearPendingHashJournalForTests,
  isRecoveryJournalStorageKey,
  recordPendingHash,
  updatePendingHashRecord,
} from '../src/lib/fx/journal';
import { createRecoveryTriggerQueue, selectRecoveryTriggerRecords } from '../src/lib/recoveryTrigger';
import { createRecoveryWalletRefresh } from '../src/lib/walletDataRefresh';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x3333333333333333333333333333333333333333';
const TARGET = '0x2222222222222222222222222222222222222222';

function record(index: number, status: PendingHashRecord['status'] = 'confirmed', walletAddress: PendingHashRecord['walletAddress'] = WALLET): PendingHashRecord {
  const hash = `0x${index.toString(16).padStart(64, '0')}` as const;
  return {
    id: `1:${walletAddress.toLowerCase()}:${hash}`, operation: 'increasePosition', walletAddress,
    chainId: 1, hash, to: TARGET, nonce: index, dataHash: hash, valueWei: '0',
    submittedAt: index, updatedAt: index + 100, status,
  };
}

test('only actual journal storage keys request cross-tab recovery', () => {
  for (const key of [
    'fxaeon:pending-hashes:v1', 'fxaeon:pending-hashes:v4',
    'fxaeon:pending-hash:v5:one', 'fxaeon:pending-event:v6:one:confirmed',
  ]) assert.equal(isRecoveryJournalStorageKey(key), true);
  for (const key of [null, '', 'fxaeon:theme:v1', 'fxaeon:pending-hashes:v7', 'other:pending-event:v6:']) {
    assert.equal(isRecoveryJournalStorageKey(key), false);
  }
});

test('ordinary triggers stay pending-only while storage triggers select bounded wallet history', () => {
  const terminal = Array.from({ length: 12 }, (_, index) => record(index + 1));
  const pending = record(99, 'pending');
  const otherWallet = record(100, 'pending', OTHER);
  const records = [...terminal, pending, otherWallet];
  assert.deepEqual(selectRecoveryTriggerRecords(records, WALLET, false).map(({ id }) => id), [pending.id]);
  const storageSelection = selectRecoveryTriggerRecords(records, WALLET, true);
  assert.equal(storageSelection.length, 9);
  assert.ok(storageSelection.some(({ id }) => id === pending.id));
  assert.deepEqual(storageSelection.filter(({ status }) => status !== 'pending').map(({ id }) => id), terminal.slice(-8).map(({ id }) => id));
  assert.ok(storageSelection.every(({ walletAddress }) => walletAddress === WALLET));
});

test('overlapping triggers are serialized and a queued terminal-history request wins', async () => {
  const calls: boolean[] = [];
  const releases: Array<() => void> = [];
  const trigger = createRecoveryTriggerQueue(async (history) => {
    calls.push(history);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const first = trigger(false);
  await Promise.resolve();
  while (releases.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(trigger(false), first);
  assert.strictEqual(trigger(true), first);
  assert.strictEqual(trigger(false), first);
  releases[0]();
  while (releases.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  releases[1]();
  await first;
  assert.deepEqual(calls, [false, true]);
});

test('same-tick storage request upgrades the initial pending-only batch', async () => {
  const calls: boolean[] = [];
  const trigger = createRecoveryTriggerQueue(async (history) => { calls.push(history); });
  const first = trigger(false);
  assert.strictEqual(trigger(true), first);
  assert.strictEqual(trigger(false), first);
  await first;
  assert.deepEqual(calls, [true]);
});

test('a failed batch does not discard a queued storage trigger', async () => {
  const calls: boolean[] = [];
  let release: (() => void) | undefined;
  const trigger = createRecoveryTriggerQueue(async (history) => {
    calls.push(history);
    if (calls.length === 1) {
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error('RPC unavailable');
    }
  });
  const first = trigger(false);
  await Promise.resolve();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  trigger(true);
  release();
  await first;
  assert.deepEqual(calls, [false, true]);
});

test('terminal local status is rechecked; only receipt verification invalidates wallet data', async () => {
  const terminal = record(7, 'confirmed');
  assert.equal(selectRecoveryTriggerRecords([terminal], WALLET, true).length, 1);
  const calls: [string, number][] = [];
  const refresh = createRecoveryWalletRefresh(async (address, chainId) => { calls.push([address, chainId]); });
  const base: RecoveryViewModel = {
    record: terminal, status: 'pending', verification: 'mismatch', explorerUrl: '', message: 'unverified',
  };
  await refresh([base], WALLET, () => true);
  assert.deepEqual(calls, []);
  await refresh([{ ...base, status: 'confirmed', verification: 'receipt', receiptBlockNumber: 123n }], WALLET, () => true);
  assert.deepEqual(calls, [[WALLET, 1]]);
});

test('same terminal status is storage-idempotent while a reorg status change is appended', () => {
  class MemoryStorage implements Storage {
    values = new Map<string, string>();
    setCalls: string[] = [];
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key: string) { return this.values.get(key) ?? null; }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
    removeItem(key: string) { this.values.delete(key); }
    setItem(key: string, value: string) { this.setCalls.push(key); this.values.set(key, value); }
  }
  const storage = new MemoryStorage();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try {
    clearPendingHashJournalForTests();
    const pending = recordPendingHash({
      operation: 'increasePosition', walletAddress: WALLET, chainId: 1,
      hash: `0x${'c'.repeat(64)}`, to: TARGET, nonce: 3, data: '0x12345678', value: 0n,
    });
    updatePendingHashRecord(pending, 'confirmed');
    const afterFirstConfirmation = storage.setCalls.length;
    updatePendingHashRecord(pending, 'confirmed');
    assert.equal(storage.setCalls.length, afterFirstConfirmation);
    updatePendingHashRecord(pending, 'failed');
    assert.equal(storage.setCalls.length, afterFirstConfirmation + 1);
  } finally {
    clearPendingHashJournalForTests();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
