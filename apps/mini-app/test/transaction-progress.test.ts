import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TransactionStepResult } from '../src/lib/fx/types';
import {
  confirmedUpdateCopy,
  hasTransactionHash,
  transactionExplorerUrl,
  transactionStepKind,
  transactionStepProgress,
} from '../src/lib/transactionProgress';

const HASH = `0x${'a'.repeat(64)}` as const;

function step(overrides: Partial<TransactionStepResult> = {}): TransactionStepResult {
  return {
    index: 0,
    transaction: {
      chainId: 1,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      data: '0x12345678',
      value: 0n,
      kind: 'action',
      operation: 'increasePosition',
    },
    status: 'submitted',
    hash: HASH,
    ...overrides,
  };
}

function receipt(status: 'success' | 'reverted'): NonNullable<TransactionStepResult['receipt']> {
  return { status, transactionHash: HASH, blockNumber: 100n } as NonNullable<TransactionStepResult['receipt']>;
}

test('a validated broadcast hash is immediately linkable before any receipt arrives', () => {
  const submitted = step();
  assert.equal(hasTransactionHash(submitted), true);
  assert.deepEqual(transactionStepProgress(submitted), { state: 'submitted', label: 'Submitted' });
  assert.equal(transactionExplorerUrl(submitted.transaction.chainId, submitted.hash), `https://etherscan.io/tx/${HASH}`);
  assert.equal(submitted.receipt, undefined);
});

test('explorer links use the original execution chain and reject unsupported chains or invalid hashes', () => {
  assert.equal(transactionExplorerUrl(1, HASH), `https://etherscan.io/tx/${HASH}`);
  assert.equal(transactionExplorerUrl(8453, HASH), `https://basescan.org/tx/${HASH}`);
  assert.equal(transactionExplorerUrl(10, HASH), null);
  assert.equal(transactionExplorerUrl(1, undefined), null);
  assert.equal(transactionExplorerUrl(1, '0xabc'), null);
  assert.equal(transactionExplorerUrl(1, `0x${'z'.repeat(64)}`), null);
});

test('an unsigned or rejected request is not presented as submitted', () => {
  assert.equal(hasTransactionHash(undefined), false);
  assert.deepEqual(transactionStepProgress(undefined), { state: 'ready', label: 'Ready' });
  assert.deepEqual(transactionStepProgress(step({ hash: undefined })), { state: 'ready', label: 'Ready' });
  assert.deepEqual(transactionStepProgress(step({ hash: undefined, status: 'failed' })), { state: 'stopped', label: 'Not submitted' });
});

test('approval and action hashes keep distinct labels and independent receipt states', () => {
  const approval = step({ status: 'confirmed', receipt: receipt('success') });
  approval.transaction = { ...approval.transaction, kind: 'approval', type: 'approveToken' };
  const action = step({ index: 1, status: 'failed', error: 'Receipt request timed out' });
  assert.equal(transactionStepKind(approval), 'Approval');
  assert.equal(transactionStepKind(action), 'Action');
  assert.deepEqual(transactionStepProgress(approval), { state: 'confirmed', label: 'Confirmed' });
  assert.deepEqual(transactionStepProgress(action), { state: 'unknown', label: 'Confirmation unknown' });
  assert.equal(transactionExplorerUrl(action.transaction.chainId, action.hash), `https://etherscan.io/tx/${HASH}`);
});

test('a receipt read failure preserves unknown submission rather than claiming failure or success', () => {
  assert.deepEqual(transactionStepProgress(step({ status: 'failed' })), { state: 'unknown', label: 'Confirmation unknown' });
  assert.deepEqual(transactionStepProgress(step({ status: 'confirmed' })), { state: 'submitted', label: 'Submitted' });
});

test('receipt status alone cannot bypass runner transaction verification', () => {
  const unverified = step({ status: 'failed', receipt: receipt('success') });
  assert.deepEqual(transactionStepProgress(unverified), { state: 'unverified', label: 'Verification incomplete' });
  assert.deepEqual(transactionStepProgress(step({ receipt: receipt('success') })), { state: 'submitted', label: 'Submitted' });
  assert.deepEqual(transactionStepProgress(step({ status: 'confirmed', receipt: receipt('success') })), { state: 'confirmed', label: 'Confirmed' });
});

test('an on-chain revert stays separate from an unverified receipt', () => {
  assert.deepEqual(transactionStepProgress(step({ status: 'failed', receipt: receipt('reverted') })), { state: 'reverted', label: 'Reverted' });
});

test('receipt-confirmed position progress distinguishes the following block from the state read', () => {
  const waiting = confirmedUpdateCopy('increasePosition', false);
  const reading = confirmedUpdateCopy('increasePosition', true);
  assert.equal(waiting.label, 'Confirmed · updating position');
  assert.match(waiting.body, /Waiting for the next block/);
  assert.equal(reading.label, waiting.label);
  assert.match(reading.body, /Verifying updated position/);
  assert.equal(confirmedUpdateCopy('depositFxSave', true).label, 'Confirmed · updating balances');
  assert.equal(confirmedUpdateCopy('buildBridgeTx', true).label, 'Confirmed on source');
  assert.match(confirmedUpdateCopy('buildBridgeTx', true).body, /Destination delivery is tracked separately/);
});
