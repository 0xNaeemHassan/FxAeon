import {
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";

/**
 * LayerZero V2's canonical IOFT delivery events.  OFTSent is emitted by the
 * source OFT after the message GUID is allocated; OFTReceived is emitted by
 * the destination OFT when the message is actually applied.  The GUID is the
 * only safe correlation key between the two chains.
 *
 * These definitions intentionally mirror LayerZero's IOFT interface instead
 * of treating a token balance delta as proof of delivery.
 */
export const OFT_SENT_EVENT = {
  type: "event",
  name: "OFTSent",
  anonymous: false,
  inputs: [
    { name: "guid", type: "bytes32", indexed: true },
    { name: "dstEid", type: "uint32", indexed: false },
    { name: "fromAddress", type: "address", indexed: true },
    { name: "amountSentLD", type: "uint256", indexed: false },
    { name: "amountReceivedLD", type: "uint256", indexed: false },
  ],
} as const;

export const OFT_RECEIVED_EVENT = {
  type: "event",
  name: "OFTReceived",
  anonymous: false,
  inputs: [
    { name: "guid", type: "bytes32", indexed: true },
    { name: "srcEid", type: "uint32", indexed: false },
    { name: "toAddress", type: "address", indexed: true },
    { name: "amountReceivedLD", type: "uint256", indexed: false },
  ],
} as const;

export type BridgeEventLog = {
  address: Address | string;
  data: Hex;
  /** RPC topics are hex strings; unknown keeps viem mock/log tuple types out of the app boundary. */
  topics: readonly unknown[];
  transactionHash?: Hex;
  blockNumber?: bigint;
  blockHash?: Hex;
  removed?: boolean;
};

export interface SourceOftSentMatch {
  guid: Hex;
  dstEid: number;
  fromAddress: Address;
  amountSentLD: bigint;
  amountReceivedLD: bigint;
  transactionHash?: Hex;
}

export interface DestinationOftReceivedMatch {
  guid: Hex;
  srcEid: number;
  toAddress: Address;
  amountReceivedLD: bigint;
  transactionHash?: Hex;
  blockNumber?: bigint;
  blockHash?: Hex;
}

export interface DestinationLogScanResult {
  match: DestinationOftReceivedMatch | null;
  /** First block that has not been scanned yet. Persist this in the caller. */
  nextBlock: bigint;
  /** True when every block through the requested head was scanned. */
  complete: boolean;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function nonZeroGuid(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} returned a malformed LayerZero message GUID`);
  }
  if (/^0x0{64}$/i.test(value)) {
    throw new Error(`${label} returned an empty LayerZero message GUID`);
  }
  return value as Hex;
}

function decodeSent(log: BridgeEventLog): SourceOftSentMatch | null {
  try {
    const decoded = decodeEventLog({
      abi: [OFT_SENT_EVENT],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "OFTSent") return null;
    const args = decoded.args as {
      guid: Hex;
      dstEid: number;
      fromAddress: Address;
      amountSentLD: bigint;
      amountReceivedLD: bigint;
    };
    return {
      guid: nonZeroGuid(args.guid, "OFTSent"),
      dstEid: Number(args.dstEid),
      fromAddress: args.fromAddress,
      amountSentLD: args.amountSentLD,
      amountReceivedLD: args.amountReceivedLD,
      transactionHash: log.transactionHash,
    };
  } catch {
    // A receipt can contain logs from many contracts and event families. An
    // undecodable log is irrelevant; a matching malformed event is rejected
    // by the caller once its address and event topic identify it.
    return null;
  }
}

function decodeReceived(log: BridgeEventLog): DestinationOftReceivedMatch | null {
  try {
    const decoded = decodeEventLog({
      abi: [OFT_RECEIVED_EVENT],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "OFTReceived") return null;
    const args = decoded.args as {
      guid: Hex;
      srcEid: number;
      toAddress: Address;
      amountReceivedLD: bigint;
    };
    return {
      guid: nonZeroGuid(args.guid, "OFTReceived"),
      srcEid: Number(args.srcEid),
      toAddress: args.toAddress,
      amountReceivedLD: args.amountReceivedLD,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
    };
  } catch {
    return null;
  }
}

/**
 * Find the one source event that proves this exact reviewed send happened.
 * Multiple matching sends are ambiguous and therefore fail closed.
 */
export function findSourceOftSent(
  logs: readonly BridgeEventLog[],
  expected: {
    sourceOftAddress: Address;
    destinationEid: number;
    sender: Address;
    amountLD: bigint;
    minimumReceivedLD: bigint;
  },
): SourceOftSentMatch {
  const sourceEvents: SourceOftSentMatch[] = [];
  for (const log of logs) {
    if (log.removed) continue;
    if (!sameAddress(log.address, expected.sourceOftAddress)) continue;
    const decoded = decodeSent(log);
    if (!decoded) continue;
    sourceEvents.push(decoded);
  }
  if (sourceEvents.length !== 1) {
    throw new Error(
      sourceEvents.length === 0
        ? "confirmed source receipt does not contain the reviewed OFTSent event"
        : "confirmed source receipt contains multiple OFTSent events from the reviewed OFT",
    );
  }
  const decoded = sourceEvents[0];
  if (decoded.dstEid !== expected.destinationEid) {
    throw new Error("source OFTSent destination EID does not match the reviewed route");
  }
  if (!sameAddress(decoded.fromAddress, expected.sender)) {
    throw new Error("source OFTSent sender does not match the reviewed wallet");
  }
  // IOFT defines these as the amounts actually debited/credited. They may be
  // lower than amountLD because of shared-decimal dust removal or an OFT fee,
  // so equality with calldata would incorrectly strand valid deliveries.
  if (decoded.amountSentLD <= 0n || decoded.amountSentLD > expected.amountLD) {
    throw new Error("source OFTSent debit is outside the reviewed amount");
  }
  if (decoded.amountReceivedLD < expected.minimumReceivedLD) {
    throw new Error("source OFTSent amount is below the reviewed delivery minimum");
  }
  return decoded;
}

/**
 * Find the one destination event for the source GUID.  The caller has already
 * constrained the RPC query to the reviewed destination OFT, but we repeat the
 * address check here so this helper is safe when used with mocked or broader
 * log responses in tests.
 */
export function findDestinationOftReceived(
  logs: readonly BridgeEventLog[],
  expected: {
    destinationOftAddress: Address;
    guid: Hex;
    sourceEid: number;
    recipient: Address;
    amountReceivedLD: bigint;
  },
): DestinationOftReceivedMatch {
  const match = findDestinationOftReceivedOrNull(logs, expected);
  if (!match) {
    throw new Error("destination chain has not emitted the matching OFTReceived event");
  }
  return match;
}

function findDestinationOftReceivedOrNull(
  logs: readonly BridgeEventLog[],
  expected: {
    destinationOftAddress: Address;
    guid: Hex;
    sourceEid: number;
    recipient: Address;
    amountReceivedLD: bigint;
  },
): DestinationOftReceivedMatch | null {
  const matches: DestinationOftReceivedMatch[] = [];
  for (const log of logs) {
    if (log.removed) continue;
    if (!sameAddress(log.address, expected.destinationOftAddress)) continue;
    const decoded = decodeReceived(log);
    if (!decoded) continue;
    if (
      decoded.guid.toLowerCase() === expected.guid.toLowerCase() &&
      decoded.srcEid === expected.sourceEid &&
      sameAddress(decoded.toAddress, expected.recipient) &&
      decoded.amountReceivedLD === expected.amountReceivedLD
    ) {
      matches.push(decoded);
    }
  }
  if (matches.length > 1) {
    throw new Error("destination chain contains multiple matching OFTReceived events");
  }
  return matches[0] ?? null;
}

/**
 * Scan an old bridge safely without asking an RPC provider for an unbounded
 * eth_getLogs range. The caller keeps `nextBlock` between polls, so an
 * undelivered message advances toward the head instead of repeatedly scanning
 * the same historical blocks. A delivered message normally appears close to
 * the saved source-time baseline and therefore resolves in the first window.
 */
export async function scanDestinationOftReceivedInChunks(params: {
  fromBlock: bigint;
  toBlock: bigint;
  getLogs: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<readonly BridgeEventLog[]>;
  expected: {
    destinationOftAddress: Address;
    guid: Hex;
    sourceEid: number;
    recipient: Address;
    amountReceivedLD: bigint;
  };
  windowSize?: bigint;
  maxWindows?: number;
}): Promise<DestinationLogScanResult> {
  const windowSize = params.windowSize ?? 2_000n;
  const maxWindows = params.maxWindows ?? 12;
  if (windowSize <= 0n) throw new RangeError("destination log window must be positive");
  if (!Number.isSafeInteger(maxWindows) || maxWindows <= 0) {
    throw new RangeError("destination log scan count must be a positive safe integer");
  }
  if (params.fromBlock > params.toBlock) {
    return { match: null, nextBlock: params.fromBlock, complete: true };
  }

  let cursor = params.fromBlock;
  let scannedWindows = 0;
  while (cursor <= params.toBlock && scannedWindows < maxWindows) {
    const candidateEnd = cursor + windowSize - 1n;
    const windowEnd = candidateEnd < params.toBlock ? candidateEnd : params.toBlock;
    const logs = await params.getLogs({ fromBlock: cursor, toBlock: windowEnd });
    const match = findDestinationOftReceivedOrNull(logs, params.expected);
    cursor = windowEnd + 1n;
    scannedWindows += 1;
    if (match) {
      return { match, nextBlock: cursor, complete: windowEnd === params.toBlock };
    }
  }

  return { match: null, nextBlock: cursor, complete: cursor > params.toBlock };
}
