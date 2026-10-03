import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import { mergeWalletActivity } from '../src/lib/walletActivity';
import type { RecoveryViewModel } from '../src/lib/fx/recovery';
import type { ProtocolPositionActivity } from '../src/lib/protocolPositionHistory';
import type { WalletTransfer } from '../src/lib/walletTransferHistory';
const wallet = '0x1111111111111111111111111111111111111111' as Address;
const hash = `0x${'a'.repeat(64)}` as Hex;
const transfer: WalletTransfer = { id: 'transfer', hash, chainId: 1, timestamp: 1_000, from: wallet, to: '0x2222222222222222222222222222222222222222', amountRaw: 123n, decimals: 18, symbol: 'ETH', tokenAddress: null };
const view = (stepKind = 'action', bridge = false): RecoveryViewModel => ({ record: { id: 'record', hash, chainId: 1, submittedAt: 999, stepKind, to: transfer.to, operation: 'increasePosition', ...(bridge ? { bridge: { bridgeToken: 'fxUSD' } } : {}) }, status: 'confirmed', verification: 'receipt' }) as RecoveryViewModel;
const position: ProtocolPositionActivity = { hash, chainId: 1, timestamp: 1, blockNumber: 123n, kind: 'close', market: 'ETH', side: 'long', positionId: 4, poolAddress: transfer.to };
test('journal, indexed transfer and position event produce one row per chain/hash', () => {
  const rows = mergeWalletActivity([view()], [position], [transfer, transfer], wallet);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Closed ETH long'); assert.equal(rows[0].transfers.length, 1);
});
test('an approval cannot become a completed position or a transfer', () => {
  const rows = mergeWalletActivity([view('approval')], [position], [transfer], wallet);
  assert.equal(rows[0].title, 'Approve token'); assert.equal(rows[0].statusLabel, 'Approved'); assert.equal(rows[0].positions.length, 0); assert.equal(rows[0].transfers.length, 0);
});
test('source bridge confirmation never means destination delivery', () => {
  assert.equal(mergeWalletActivity([view('action', true)], [], [transfer], wallet)[0].statusLabel, 'Source confirmed');
});
test('index-only transfers have direction without claiming receipt verification', () => {
  const [sent] = mergeWalletActivity([], [], [transfer], wallet);
  assert.equal(sent.title, 'Sent'); assert.equal(sent.status, 'indexed'); assert.equal(sent.statusLabel, '');
  assert.equal(mergeWalletActivity([], [], [transfer], transfer.to)[0].title, 'Received');
});
test('pending and failed local evidence is not overwritten by an indexed transfer', () => {
  const pending = { ...view(), status: 'pending', verification: 'rpc-error' } as RecoveryViewModel;
  assert.equal(mergeWalletActivity([pending], [], [transfer], wallet)[0].status, 'pending');
  const failed = { ...view(), status: 'failed' } as RecoveryViewModel;
  assert.equal(mergeWalletActivity([failed], [], [transfer], wallet)[0].transfers.length, 0);
  // A cached protocol event cannot override a later pending/reverted receipt.
  assert.equal(mergeWalletActivity([pending], [position], [], wallet)[0].status, 'pending');
  assert.equal(mergeWalletActivity([failed], [position], [], wallet)[0].status, 'failed');
});
