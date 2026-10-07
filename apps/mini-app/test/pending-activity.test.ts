import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import { PENDING_RING_WINDOW_MS, freshPendingCount, isTransactionPresented, noticeFor, presentTransactionHashes, settledSince } from '../src/lib/pendingActivity';
import type { PendingHashRecord } from '../src/lib/fx/types';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const NOW = 1_800_000_000_000;

function record(overrides: Partial<PendingHashRecord> = {}): PendingHashRecord {
  return {
    id: `1:${WALLET}:0x${'a'.repeat(64)}`,
    operation: 'increasePosition',
    stepKind: 'action',
    intent: 'Open position',
    walletAddress: WALLET,
    chainId: 1,
    hash: `0x${'a'.repeat(64)}` as Hex,
    to: '0x3333333333333333333333333333333333333333' as Address,
    submittedAt: NOW - 60_000,
    status: 'pending',
    ...overrides,
  };
}

test('the wallet rings only for its own recent pending steps', () => {
  const records = [
    record({ id: 'a' }),
    record({ id: 'b', walletAddress: OTHER }),
    record({ id: 'c', status: 'confirmed' }),
    record({ id: 'd', submittedAt: NOW - PENDING_RING_WINDOW_MS - 1 }),
    record({ id: 'e', walletAddress: WALLET.toUpperCase() as Address }),
  ];
  assert.equal(freshPendingCount(records, WALLET, NOW), 2);
  assert.equal(freshPendingCount([], WALLET, NOW), 0);
});

test('settled actions read as what happened, on which network', () => {
  assert.deepEqual(noticeFor(record({ status: 'confirmed' })), { id: record().id, status: 'confirmed', title: 'Position opened', detail: 'Confirmed on Ethereum.' });
  assert.equal(noticeFor(record({ status: 'confirmed', intent: 'Deposit', chainId: 8453 }))?.detail, 'Confirmed on Base.');
  assert.equal(noticeFor(record({ status: 'confirmed', intent: 'Deposit' }))?.title, 'Deposited to fxSAVE');
  assert.equal(noticeFor(record({ status: 'confirmed', intent: undefined }))?.title, 'Transaction confirmed');
  const bridge = noticeFor(record({ status: 'confirmed', intent: 'Bridge', bridge: { destinationChainId: 8453 } as PendingHashRecord['bridge'] }));
  assert.equal(bridge?.title, 'Bridge sent');
  assert.equal(bridge?.detail, 'Confirmed on Ethereum. Delivery is tracked in History.');
  assert.deepEqual(noticeFor(record({ status: 'failed' })), { id: record().id, status: 'failed', title: 'Open position failed', detail: 'Nothing moved except the network fee.' });
  assert.equal(noticeFor(record()), null);
});

test('approvals stay quiet unless they fail', () => {
  assert.equal(noticeFor(record({ stepKind: 'approval', status: 'confirmed' })), null);
  assert.equal(noticeFor(record({ stepKind: 'approval', status: 'failed' }))?.title, 'Approval failed');
});

test('only steps seen pending and now settled produce notices', () => {
  const previous = new Map<string, PendingHashRecord['status']>([['a', 'pending'], ['b', 'pending'], ['c', 'confirmed'], ['d', 'pending']]);
  const notices = settledSince(previous, [
    record({ id: 'a', status: 'confirmed' }),
    record({ id: 'b', status: 'pending' }),
    record({ id: 'c', status: 'confirmed' }),
    record({ id: 'd', status: 'failed', walletAddress: OTHER }),
    record({ id: 'e', status: 'confirmed' }),
  ], WALLET);
  assert.deepEqual(notices.map((notice) => notice.id), ['a']);
});

test('a step the open review already shows settles without a second notice', () => {
  const previous = new Map<string, PendingHashRecord['status']>([['a', 'pending']]);
  const settled = [record({ id: 'a', status: 'confirmed' })];
  const releaseReview = presentTransactionHashes([`0x${'A'.repeat(64)}`]);
  const releaseOther = presentTransactionHashes([`0x${'a'.repeat(64)}`]);
  assert.deepEqual(settledSince(previous, settled, WALLET, isTransactionPresented), []);
  releaseReview();
  assert.equal(isTransactionPresented(`0x${'a'.repeat(64)}`), true, 'one surface still shows it');
  releaseOther();
  assert.deepEqual(settledSince(previous, settled, WALLET, isTransactionPresented).map((notice) => notice.id), ['a']);
});
