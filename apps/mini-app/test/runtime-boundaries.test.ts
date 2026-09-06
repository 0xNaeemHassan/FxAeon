import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { runTransactionRoute, waitForConfirmations, TransactionReorgError } from '../src/lib/fx/runner';
import { verifyPositionGroupOwnership } from '../src/app/trade/fxUi';
import { withReadDeadline } from '../src/lib/fx/readFacade';
import { clearPendingHashJournalForTests, readPendingHashJournal, recordPendingHash } from '../src/lib/fx/journal';
import { reconcileWalletJournal } from '../src/lib/fx/recovery';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import type { FxPublicClient, PlannedRoute, TransactionPolicy } from '../src/lib/fx/types';

const HASH = `0x${'a'.repeat(64)}` as Hex;
const BLOCK_HASH = `0x${'b'.repeat(64)}` as Hex;
const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const DESTINATION = '0x2222222222222222222222222222222222222222' as Address;
const HASH_2 = `0x${'c'.repeat(64)}` as Hex;
const BLOCK_HASH_2 = `0x${'d'.repeat(64)}` as Hex;
const POLICY: TransactionPolicy = {
  walletAddress: WALLET,
  chainId: 1,
  allowedDestinations: [DESTINATION],
  allowedSelectors: { [DESTINATION.toLowerCase()]: ['0x12345678'] },
};

function testRoute(count = 1): PlannedRoute {
  return {
    operation: 'increasePosition',
    chainId: 1,
    walletAddress: WALLET,
    transactions: Array.from({ length: count }, (_, index) => ({
      chainId: 1 as const,
      from: WALLET,
      to: DESTINATION,
      data: '0x12345678' as Hex,
      value: 0n,
      nonce: 4 + index,
      kind: 'action' as const,
      operation: 'increasePosition' as const,
    })),
  };
}

function receipt(blockNumber: bigint, blockHash: Hex = BLOCK_HASH): TransactionReceipt {
  return {
    transactionHash: HASH,
    blockHash,
    blockNumber,
    from: WALLET,
    to: '0x2222222222222222222222222222222222222222',
    cumulativeGasUsed: 1n,
    gasUsed: 1n,
    transactionIndex: 0,
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'0'.repeat(512)}` as Hex,
    status: 'success',
    effectiveGasPrice: 1n,
    type: 'eip1559',
  } as TransactionReceipt;
}

test('confirmation gate rechecks inclusion and waits for three confirmations', async () => {
  const heads = [10n, 11n, 12n];
  let receiptReads = 0;
  const progress: number[] = [];
  const result = await waitForConfirmations({
    client: {
      getTransactionReceipt: async () => { receiptReads += 1; return receipt(10n); },
      getBlockNumber: async () => heads.shift() ?? 12n,
    },
    hash: HASH,
    receipt: receipt(10n),
    pollMs: 0,
    timeoutMs: 100,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.blockHash, BLOCK_HASH);
  assert.equal(receiptReads, 3);
  assert.deepEqual(progress, [1, 2, 3]);
});

test('confirmation gate downgrades on a changed receipt block identity', async () => {
  await assert.rejects(
    waitForConfirmations({
      client: {
        getTransactionReceipt: async () => receipt(10n, `0x${'c'.repeat(64)}` as Hex),
        getBlockNumber: async () => 12n,
      },
      hash: HASH,
      receipt: receipt(10n),
      timeoutMs: 100,
      pollMs: 0,
    }),
    (error: unknown) => error instanceof TransactionReorgError,
  );
});

test('position discovery requires canonical ownerOf for every indexed ID', async () => {
  const info = {
    positionId: 7,
    rawColls: 1n,
    rawDebts: 2n,
  } as PositionInfo;
  let reads = 0;
  const result = await verifyPositionGroupOwnership({
    client: {
      readContract: async () => { reads += 1; return WALLET; },
    } as Pick<FxPublicClient, 'readContract'>,
    walletAddress: WALLET,
    group: { market: 'ETH', side: 'long' },
    positions: [info],
  });
  assert.equal(result[0], info);
  assert.equal(reads, 1);
});

test('application read facade bounds a stalled SDK/indexer promise', async () => {
  await assert.rejects(withReadDeadline(new Promise<never>(() => undefined), 10), /read deadline exceeded/);
});

test('confirmation depth cannot be lowered below the production minimum', async () => {
  await assert.rejects(
    waitForConfirmations({
      client: { getTransactionReceipt: async () => receipt(10n), getBlockNumber: async () => 12n },
      hash: HASH,
      receipt: receipt(10n),
      confirmations: 2,
    }),
    /between 3 and 64/,
  );
});

test('route lifecycle waits for three confirmations before signing the dependent step', async () => {
  clearPendingHashJournalForTests();
  let receiptCalls = 0;
  let headIndex = 0;
  const steps: string[] = [];
  const result = await runTransactionRoute({
    route: testRoute(2),
    policy: POLICY,
    publicClient: {
      chain: { id: 1 },
      getChainId: async () => 1,
      simulateCalls: async () => ({ results: [] }),
      getTransactionCount: async () => 4 + Math.floor(receiptCalls / 4),
      getTransactionReceipt: async () => {
        const tx = Math.min(Math.floor(receiptCalls / 4), 1);
        receiptCalls += 1;
        return {
          ...receipt(BigInt(tx === 0 ? 10 : 13), tx === 0 ? BLOCK_HASH : BLOCK_HASH_2),
          transactionHash: tx === 0 ? HASH : HASH_2,
        };
      },
      getTransaction: async ({ hash }: { hash: Hex }) => ({
        hash,
        from: WALLET,
        to: DESTINATION,
        input: '0x12345678',
        value: 0n,
        nonce: hash === HASH ? 4 : 5,
      }),
      getBlockNumber: async () => [10n, 11n, 12n, 13n, 14n, 15n][headIndex++] ?? 15n,
    } as unknown as FxPublicClient,
    callbacks: {
      requestSignature: async ({ nonce }) => nonce === 4 ? HASH : HASH_2,
      onStatus: (status) => steps.push(status),
      onStep: (step) => steps.push(`step:${step.index}:${step.status}`),
    },
    options: { simulate: false, pollMs: 0, waitForNextBlock: false },
  });
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.steps.map((step) => step.status), ['confirmed', 'confirmed']);
  assert.deepEqual(steps.filter((value) => value.startsWith('step:0:')), [
    'step:0:submitted', 'step:0:included', 'step:0:confirming', 'step:0:confirming', 'step:0:confirming', 'step:0:confirmed',
  ]);
  assert.ok(steps.indexOf('step:0:confirmed') < steps.indexOf('step:1:submitted'));
  clearPendingHashJournalForTests();
});

test('route rejects a missing block hash and leaves the signed journal pending', async () => {
  clearPendingHashJournalForTests();
  const result = await runTransactionRoute({
    route: testRoute(),
    policy: POLICY,
    publicClient: {
      chain: { id: 1 }, getChainId: async () => 1, simulateCalls: async () => ({ results: [] }),
      getTransactionCount: async () => 4,
      getTransactionReceipt: async () => ({ ...receipt(10n), blockHash: undefined }),
      getTransaction: async ({ hash }: { hash: Hex }) => ({ hash, from: WALLET, to: DESTINATION, input: '0x12345678', value: 0n, nonce: 4 }),
      getBlockNumber: async () => 12n,
    } as unknown as FxPublicClient,
    callbacks: { requestSignature: async () => HASH },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /block hash/);
  assert.equal(readPendingHashJournal()[0]?.status, 'pending');
  clearPendingHashJournalForTests();
});

test('route reorg downgrades inclusion and retains a pending recovery record', async () => {
  clearPendingHashJournalForTests();
  let calls = 0;
  const result = await runTransactionRoute({
    route: testRoute(), policy: POLICY,
    publicClient: {
      chain: { id: 1 }, getChainId: async () => 1, simulateCalls: async () => ({ results: [] }),
      getTransactionCount: async () => 4,
      getTransactionReceipt: async () => ({ ...receipt(10n, calls++ === 0 ? BLOCK_HASH : BLOCK_HASH_2) }),
      getTransaction: async ({ hash }: { hash: Hex }) => ({ hash, from: WALLET, to: DESTINATION, input: '0x12345678', value: 0n, nonce: 4 }),
      getBlockNumber: async () => 12n,
    } as unknown as FxPublicClient,
    callbacks: { requestSignature: async () => HASH },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0]?.status, 'submitted');
  assert.equal(readPendingHashJournal()[0]?.status, 'pending');
  clearPendingHashJournalForTests();
});

test('recovery rejects a final receipt whose status changed after the depth check', async () => {
  clearPendingHashJournalForTests();
  const record = recordPendingHash({ operation: 'increasePosition', walletAddress: WALLET, chainId: 1, hash: HASH, to: DESTINATION, nonce: 4, data: '0x12345678', value: 0n });
  let calls = 0;
  const views = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => ({
      chain: { id: 1 }, getChainId: async () => 1, getBlockNumber: async () => 12n,
      getTransactionReceipt: async () => ({ ...receipt(10n), transactionHash: HASH, status: calls++ === 0 ? 'success' : 'reverted' }),
      getTransaction: async () => ({ hash: HASH, from: WALLET, to: DESTINATION, input: '0x12345678', value: 0n, nonce: 4 }),
    } as unknown as FxPublicClient),
  });
  assert.equal(views[0]?.status, 'pending');
  assert.equal(views[0]?.verification, 'mismatch');
  assert.equal(readPendingHashJournal().find((item) => item.id === record.id)?.status, 'pending');
  clearPendingHashJournalForTests();
});
