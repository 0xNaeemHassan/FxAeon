import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { waitForConfirmations, TransactionReorgError } from '../src/lib/fx/runner';
import { verifyPositionGroupOwnership } from '../src/app/trade/fxUi';
import { withReadDeadline } from '../src/lib/fx/readFacade';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import type { FxPublicClient } from '../src/lib/fx/types';

const HASH = `0x${'a'.repeat(64)}` as Hex;
const BLOCK_HASH = `0x${'b'.repeat(64)}` as Hex;
const WALLET = '0x1111111111111111111111111111111111111111' as Address;

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
