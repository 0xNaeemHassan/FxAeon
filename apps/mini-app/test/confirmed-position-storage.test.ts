import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import type { ConfirmedPositionHint } from '../src/lib/confirmedPositions';
import {
  confirmedPositionHintKey,
  confirmedPositionStorageKey,
  parseStoredPositionHints,
  savePositionHints,
  type StoredPositionHint,
} from '../src/lib/confirmedPositionStorage';
import { positionPoolAddress } from '../src/lib/fx/policy';

const WALLET = `0x${'ab'.repeat(20)}` as Address;
const OTHER = `0x${'cd'.repeat(20)}` as Address;
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function hint(positionId = 42, overrides: Partial<ConfirmedPositionHint> = {}): ConfirmedPositionHint {
  return {
    version: 1, chainId: 1, operation: 'increasePosition', walletAddress: WALLET,
    market: 'ETH', side: 'long', poolAddress: positionPoolAddress('ETH', 'long'), positionId,
    transactionHash: `0x${'aa'.repeat(32)}` as Hex, blockNumber: '100', blockHash: `0x${'bb'.repeat(32)}` as Hex,
    ...overrides,
  };
}

function record(positionId = 42, addedAt = NOW - 1_000, overrides: Partial<ConfirmedPositionHint> = {}): StoredPositionHint {
  return { hint: hint(positionId, overrides), addedAt };
}

function memoryStorage() {
  const values = new Map<string, string>();
  const operations: Array<{ kind: 'set' | 'remove'; key: string }> = [];
  return {
    values, operations,
    setItem(key: string, value: string) { operations.push({ kind: 'set', key }); values.set(key, value); },
    removeItem(key: string) { operations.push({ kind: 'remove', key }); values.delete(key); },
  };
}

test('stored hints round-trip without financial fields and normalize account storage keys', () => {
  const storage = memoryStorage();
  const records = [record()];
  savePositionHints(storage, WALLET.toUpperCase(), records);
  assert.equal(confirmedPositionStorageKey(WALLET.toUpperCase()), confirmedPositionStorageKey(WALLET));
  const raw = storage.values.get(confirmedPositionStorageKey(WALLET))!;
  assert.deepEqual(parseStoredPositionHints(raw, WALLET, NOW), records);
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ['addedAt', 'hint']);
  assert.equal(raw.includes('rawColls'), false);
  assert.equal(raw.includes('leverage'), false);
});

test('corrupt JSON, non-array envelopes and malformed records fail closed without discarding valid neighbors', () => {
  for (const raw of [null, '', 'not json', '{', '{}', 'null', 'true', '42', '"[]"']) {
    assert.deepEqual(parseStoredPositionHints(raw, WALLET, NOW), []);
  }
  const malformed = [null, false, 1, 'hint', [], {}, { hint: hint() }, { addedAt: NOW },
    { hint: null, addedAt: NOW }, { hint: { ...hint(), rawColls: '1000' }, addedAt: NOW },
    { hint: { ...hint(), positionId: '42' }, addedAt: NOW }, { hint: { ...hint(), chainId: 8453 }, addedAt: NOW }];
  for (const item of malformed) {
    assert.deepEqual(parseStoredPositionHints(JSON.stringify([item, record(43)]), WALLET, NOW), [record(43)]);
  }
});

test('cross-account and wrong-market hints cannot be restored into the current wallet', () => {
  const records = [
    record(42, NOW - 1000, { walletAddress: OTHER }),
    record(42, NOW - 1000, { market: 'BTC' }),
    record(42, NOW - 1000, { side: 'short' }),
    record(42, NOW - 1000, { poolAddress: OTHER }),
    record(42),
  ];
  assert.deepEqual(parseStoredPositionHints(JSON.stringify(records), WALLET, NOW), [record(42)]);
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([record(42)]), OTHER, NOW), []);
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([record(42)]), 'not a wallet', NOW), []);
  const storage = memoryStorage();
  savePositionHints(storage, WALLET, [record()]);
  savePositionHints(storage, OTHER, [record(99, NOW - 1000, { walletAddress: OTHER })]);
  assert.notEqual(confirmedPositionStorageKey(WALLET), confirmedPositionStorageKey(OTHER));
  assert.deepEqual(parseStoredPositionHints(storage.values.get(confirmedPositionStorageKey(OTHER))!, WALLET, NOW), []);
});

test('TTL keeps the exact 24-hour boundary and rejects expired, future and malformed timestamps', () => {
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([record(1, NOW), record(2, NOW - DAY)]), WALLET, NOW), [record(1, NOW), record(2, NOW - DAY)]);
  for (const addedAt of [NOW - DAY - 1, NOW + 1, NOW - 0.5, Number.MAX_SAFE_INTEGER + 1, -1, null, '1000', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(parseStoredPositionHints(JSON.stringify([{ hint: hint(), addedAt }]), WALLET, NOW), []);
  }
});

test('duplicate IDs are scoped by market and side, with invalid earlier duplicates unable to mask a valid record', () => {
  const ethLong = record();
  const ethShort = record(42, NOW - 1000, { side: 'short', poolAddress: positionPoolAddress('ETH', 'short') });
  const btcLong = record(42, NOW - 1000, { market: 'BTC', poolAddress: positionPoolAddress('BTC', 'long') });
  assert.equal(confirmedPositionHintKey(ethLong.hint), 'ETH:long:42');
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([ethLong, record(42, NOW - 10), ethShort, btcLong]), WALLET, NOW), [ethLong, ethShort, btcLong]);
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([record(42, NOW - DAY - 1), record(42, NOW - 1000, { walletAddress: OTHER }), ethLong]), WALLET, NOW), [ethLong]);
});

test('restore caps both serialized length and record count before accepting stored hints', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => record(index + 1));
  const raw = JSON.stringify(twelve);
  assert.deepEqual(parseStoredPositionHints(raw, WALLET, NOW), twelve);
  assert.deepEqual(parseStoredPositionHints(raw.padEnd(32_000, ' '), WALLET, NOW), twelve);
  assert.deepEqual(parseStoredPositionHints(raw.padEnd(32_001, ' '), WALLET, NOW), []);
  assert.deepEqual(parseStoredPositionHints(JSON.stringify([...twelve, record(13)]), WALLET, NOW), []);
});

test('saving retains only the newest twelve records without mutating the caller array', () => {
  const storage = memoryStorage();
  const records = Array.from({ length: 15 }, (_, index) => record(index + 1));
  const original = structuredClone(records);
  savePositionHints(storage, WALLET, records);
  const raw = storage.values.get(confirmedPositionStorageKey(WALLET))!;
  assert.deepEqual(parseStoredPositionHints(raw, WALLET, NOW), records.slice(-12));
  assert.deepEqual(records, original);
  assert.equal(raw.length < 32_000, true);
});

test('saving an empty list removes only this wallet key and preserves unrelated storage', () => {
  const storage = memoryStorage();
  storage.values.set('unrelated', 'keep');
  savePositionHints(storage, WALLET, [record()]);
  savePositionHints(storage, OTHER, [record(43, NOW - 1000, { walletAddress: OTHER })]);
  savePositionHints(storage, WALLET, []);
  assert.equal(storage.values.has(confirmedPositionStorageKey(WALLET)), false);
  assert.equal(storage.values.has(confirmedPositionStorageKey(OTHER)), true);
  assert.equal(storage.values.get('unrelated'), 'keep');
  assert.deepEqual(storage.operations.at(-1), { kind: 'remove', key: confirmedPositionStorageKey(WALLET) });
});

test('storage quota, privacy restrictions, and serialization failures cannot turn transaction success into an exception', () => {
  const records = [record()];
  const throwingStorage = {
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.doesNotThrow(() => savePositionHints(throwingStorage, WALLET, records));
  assert.doesNotThrow(() => savePositionHints(throwingStorage, WALLET, []));
  assert.equal(records.length, 1);
  const inaccessibleStorage = { get setItem(): (key: string, value: string) => void { throw new Error('Storage disabled'); }, removeItem() {} };
  assert.doesNotThrow(() => savePositionHints(inaccessibleStorage, WALLET, records));
  const circular = record() as StoredPositionHint & { circular?: unknown };
  circular.circular = circular;
  assert.doesNotThrow(() => savePositionHints(memoryStorage(), WALLET, [circular]));
});
