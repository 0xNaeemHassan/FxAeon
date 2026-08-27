import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
} from 'viem';
import {
  findDestinationOftReceived,
  findSourceOftSent,
  OFT_RECEIVED_EVENT,
  OFT_SENT_EVENT,
  scanDestinationOftReceivedInChunks,
} from '../src/lib/fx/bridgeDelivery';

const SOURCE = '0x1111111111111111111111111111111111111111' as Address;
const DESTINATION = '0x2222222222222222222222222222222222222222' as Address;
const RECIPIENT = '0x3333333333333333333333333333333333333333' as Address;
const GUID = `0x${'ab'.repeat(32)}` as Hex;
const AMOUNT = 10n ** 18n;
const RECEIVED = 999_900_000_000_000_000n;

function sentLog(overrides: { address?: Address; dstEid?: number; from?: Address; amount?: bigint; received?: bigint; transactionHash?: Hex } = {}) {
  const from = overrides.from ?? RECIPIENT;
  return {
    address: overrides.address ?? SOURCE,
    topics: encodeEventTopics({ abi: [OFT_SENT_EVENT], eventName: 'OFTSent', args: { guid: GUID, fromAddress: from } }),
    data: encodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint256' }, { type: 'uint256' }],
      [overrides.dstEid ?? 30184, overrides.amount ?? AMOUNT, overrides.received ?? RECEIVED],
    ),
    transactionHash: overrides.transactionHash ?? (`0x${'12'.repeat(32)}` as Hex),
  } as const;
}

function receivedLog(overrides: { address?: Address; srcEid?: number; to?: Address; guid?: Hex; received?: bigint; transactionHash?: Hex; blockNumber?: bigint; blockHash?: Hex; removed?: boolean } = {}) {
  const guid = overrides.guid ?? GUID;
  const to = overrides.to ?? RECIPIENT;
  return {
    address: overrides.address ?? DESTINATION,
    topics: encodeEventTopics({ abi: [OFT_RECEIVED_EVENT], eventName: 'OFTReceived', args: { guid, toAddress: to } }),
    data: encodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint256' }],
      [overrides.srcEid ?? 30101, overrides.received ?? RECEIVED],
    ),
    transactionHash: overrides.transactionHash ?? (`0x${'34'.repeat(32)}` as Hex),
    blockNumber: overrides.blockNumber,
    blockHash: overrides.blockHash,
    removed: overrides.removed,
  } as const;
}

test('source delivery proof requires one exact OFTSent event from the reviewed OFT', () => {
  const match = findSourceOftSent([sentLog()], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  });
  assert.equal(match.guid, GUID);
  assert.equal(match.amountReceivedLD, RECEIVED);
  assert.equal(match.transactionHash, `0x${'12'.repeat(32)}`);
});

test('source proof rejects a wrong OFT, sender, destination EID, or excessive debit', () => {
  assert.throws(() => findSourceOftSent([sentLog({ address: DESTINATION })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /does not contain/);
  assert.throws(() => findSourceOftSent([sentLog({ from: SOURCE })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /sender/);
  assert.throws(() => findSourceOftSent([sentLog({ dstEid: 30101 })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /destination EID/);
  assert.throws(() => findSourceOftSent([sentLog({ amount: AMOUNT + 1n })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /outside/);
});

test('source proof accepts actual debit dust adjustment while preserving the reviewed minimum', () => {
  const adjusted = AMOUNT - 1n;
  const match = findSourceOftSent([sentLog({ amount: adjusted })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  });
  assert.equal(match.amountSentLD, adjusted);
  assert.equal(match.amountReceivedLD, RECEIVED);
});

test('source proof rejects ambiguous duplicate sends and insufficient remote amount', () => {
  assert.throws(() => findSourceOftSent([sentLog(), sentLog({ transactionHash: `0x${'56'.repeat(32)}` })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /multiple/);
  assert.throws(() => findSourceOftSent([sentLog({ received: RECEIVED - 1n })], {
    sourceOftAddress: SOURCE,
    destinationEid: 30184,
    sender: RECIPIENT,
    amountLD: AMOUNT,
    minimumReceivedLD: RECEIVED,
  }), /below/);
});

test('destination delivery proof requires the same GUID, reviewed OFT, source EID, recipient, and exact amount', () => {
  const match = findDestinationOftReceived([receivedLog()], {
    destinationOftAddress: DESTINATION,
    guid: GUID,
    sourceEid: 30101,
    recipient: RECIPIENT,
    amountReceivedLD: RECEIVED,
  });
  assert.equal(match.guid, GUID);
  assert.equal(match.amountReceivedLD, RECEIVED);
  assert.equal(match.transactionHash, `0x${'34'.repeat(32)}`);

  assert.throws(() => findDestinationOftReceived([
    receivedLog({ address: SOURCE }),
    receivedLog({ guid: `0x${'cd'.repeat(32)}` }),
    receivedLog({ srcEid: 30184 }),
    receivedLog({ to: SOURCE }),
    receivedLog({ received: RECEIVED + 1n }),
  ], {
    destinationOftAddress: DESTINATION,
    guid: GUID,
    sourceEid: 30101,
    recipient: RECIPIENT,
    amountReceivedLD: RECEIVED,
  }), /has not emitted/);
});

test('destination delivery proof ignores removed logs and preserves block metadata', () => {
  const blockHash = `0x${'56'.repeat(32)}` as Hex;
  assert.throws(() => findDestinationOftReceived([receivedLog({ removed: true })], {
    destinationOftAddress: DESTINATION,
    guid: GUID,
    sourceEid: 30101,
    recipient: RECIPIENT,
    amountReceivedLD: RECEIVED,
  }), /has not emitted/);

  const match = findDestinationOftReceived([receivedLog({ blockNumber: 456n, blockHash })], {
    destinationOftAddress: DESTINATION,
    guid: GUID,
    sourceEid: 30101,
    recipient: RECIPIENT,
    amountReceivedLD: RECEIVED,
  });
  assert.equal(match.blockNumber, 456n);
  assert.equal(match.blockHash, blockHash);
});

test('destination recovery scans bounded windows and stops at the matching GUID', async () => {
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  const result = await scanDestinationOftReceivedInChunks({
    fromBlock: 100n,
    toBlock: 10_000n,
    windowSize: 2_000n,
    maxWindows: 12,
    getLogs: async (range) => {
      ranges.push(range);
      return range.fromBlock === 2_100n ? [receivedLog()] : [];
    },
    expected: {
      destinationOftAddress: DESTINATION,
      guid: GUID,
      sourceEid: 30101,
      recipient: RECIPIENT,
      amountReceivedLD: RECEIVED,
    },
  });

  assert.equal(result.match?.guid, GUID);
  assert.deepEqual(ranges, [
    { fromBlock: 100n, toBlock: 2_099n },
    { fromBlock: 2_100n, toBlock: 4_099n },
  ]);
  assert.equal(result.nextBlock, 4_100n);
});

test('destination recovery exposes a resumable cursor when the bounded scan has not caught up', async () => {
  const first = await scanDestinationOftReceivedInChunks({
    fromBlock: 100n,
    toBlock: 10_000n,
    windowSize: 2_000n,
    maxWindows: 2,
    getLogs: async () => [],
    expected: {
      destinationOftAddress: DESTINATION,
      guid: GUID,
      sourceEid: 30101,
      recipient: RECIPIENT,
      amountReceivedLD: RECEIVED,
    },
  });
  assert.equal(first.match, null);
  assert.equal(first.complete, false);
  assert.equal(first.nextBlock, 4_100n);

  const second = await scanDestinationOftReceivedInChunks({
    fromBlock: first.nextBlock,
    toBlock: 10_000n,
    windowSize: 2_000n,
    maxWindows: 2,
    getLogs: async (range) => range.fromBlock === 4_100n ? [receivedLog()] : [],
    expected: {
      destinationOftAddress: DESTINATION,
      guid: GUID,
      sourceEid: 30101,
      recipient: RECIPIENT,
      amountReceivedLD: RECEIVED,
    },
  });
  assert.equal(second.match?.guid, GUID);
});
