import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecoveryViewModel } from '../src/lib/fx/recovery';
import { selectExecutionTask, selectWalletTasks } from '../src/lib/taskState';
import type { Address } from 'viem';
import type { TransactionExecutionResult } from '../src/lib/fx/types';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;

function transaction(walletAddress: Address, verification: RecoveryViewModel['verification']): RecoveryViewModel {
  return {
    record: { id: walletAddress, walletAddress } as RecoveryViewModel['record'],
    status: 'pending', verification, explorerUrl: '', message: 'Unverified transaction.',
  };
}

test('wallet task selector scopes transaction facts by identity and never offers retry for submitted hashes', () => {
  const tasks = selectWalletTasks({ walletAddress: WALLET, transactions: [
    transaction(WALLET, 'rpc-error'), transaction(OTHER, 'not-found'),
  ] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.state, 'uncertain');
  assert.equal(tasks[0]?.href, '/history');
  assert.equal(tasks[0]?.retryable, false);
});

test('withdrawal task only appears for a verified pending cooldown or ready claim', () => {
  const base = { walletAddress: WALLET, transactions: [] };
  const pending = selectWalletTasks({ ...base, claimable: {
    hasPendingRedeem: true, pendingSharesWei: 1n, isCooldownComplete: false, redeemableAt: 10,
  } });
  assert.deepEqual(pending.map((task) => task.state), ['pending']);
  const ready = selectWalletTasks({ ...base, claimable: {
    hasPendingRedeem: true, pendingSharesWei: 1n, isCooldownComplete: true, redeemableAt: 10,
  } });
  assert.deepEqual(ready.map((task) => task.state), ['ready']);
  assert.equal(selectWalletTasks({ ...base, claimable: null }).length, 0);
});

test('a broadcast execution result is routed to History and never marked retryable', () => {
  const task = selectExecutionTask({ status: 'failed', operation: 'depositFxSave', chainId: 1, walletAddress: WALLET,
    steps: [{ hash: `0x${'a'.repeat(64)}`, status: 'failed', index: 0, transaction: { kind: 'action' } }],
  } as unknown as TransactionExecutionResult);
  assert.equal(task?.state, 'uncertain');
  assert.equal(task?.href, '/history');
  assert.equal(task?.retryable, false);
  assert.equal(selectExecutionTask({ status: 'failed', operation: 'depositFxSave', chainId: 1, walletAddress: WALLET, steps: [] }), null);
});

test('partial and unavailable valuation states produce distinct actionable tasks', () => {
  const base = { walletAddress: WALLET, transactions: [] };
  assert.equal(selectWalletTasks({ ...base, valuation: 'partial' })[0]?.title, 'Some assets could not be valued');
  const unavailable = selectWalletTasks({ ...base, valuation: 'unavailable' })[0];
  assert.equal(unavailable?.title, 'Portfolio value unavailable');
  assert.equal(unavailable?.href, '/portfolio#portfolio-assets-heading');
});
