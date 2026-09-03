import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { clearPendingHashJournalForTests, readPendingHashJournal, readPendingHashes } from "../src/lib/fx/journal";
import { runTransactionRoute, simulatePlannedRoute, waitForReceipt } from "../src/lib/fx/runner";
import type { FxPublicClient, PlannedRoute, PlannedTransaction, TransactionPolicy } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DESTINATION = "0x2222222222222222222222222222222222222222" as Address;
const HASH_1 = `0x${"1".repeat(64)}` as Hex;
const HASH_2 = `0x${"2".repeat(64)}` as Hex;
const BRIDGE_ABI = parseAbi([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress)",
]);
const TEST_POLICY: TransactionPolicy = {
  walletAddress: WALLET,
  chainId: 1,
  allowedDestinations: [DESTINATION],
  allowedSelectors: { [DESTINATION.toLowerCase()]: ["0x12345678"] },
};

test("receipt waiting always makes the immediate RPC probe at a zero deadline", async () => {
  let calls = 0;
  const receipt = await waitForReceipt({
    client: {
      getTransactionReceipt: async ({ hash }) => {
        calls += 1;
        return { transactionHash: hash, status: "success", blockNumber: 1n } as never;
      },
    },
    hash: HASH_1,
    timeoutMs: 0,
    pollMs: 0,
  });

  assert.equal(calls, 1);
  assert.equal(receipt.transactionHash, HASH_1);
});

function route(count = 2): PlannedRoute {
  return {
    operation: "increasePosition",
    chainId: 1,
    walletAddress: WALLET,
    transactions: Array.from({ length: count }, (_, index): PlannedTransaction => ({
      chainId: 1,
      from: WALLET,
      to: DESTINATION,
      data: "0x12345678",
      value: 0n,
      nonce: 4 + index,
      kind: "action",
      operation: "increasePosition",
    })),
  };
}

function bridgeData(): Hex {
  return encodeFunctionData({
    abi: BRIDGE_ABI,
    functionName: "send",
    args: [{
      dstEid: 30184,
      to: `0x${WALLET.slice(2).padStart(64, "0")}` as Hex,
      amountLD: 1_000_000_000_000_000_000n,
      minAmountLD: 1_000_000_000_000_000_000n,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
    }, { nativeFee: 0n, lzTokenFee: 0n }, WALLET],
  }) as Hex;
}

function client(params: {
  pendingNonces: number[];
  receipts: Array<{ status: "success" | "reverted"; blockNumber: bigint }>;
  blocks: bigint[];
  remoteChainId?: number;
}): FxPublicClient {
  let nonceIndex = 0;
  let receiptIndex = 0;
  let blockIndex = 0;
  return {
    chain: { id: 1 },
    getChainId: async () => params.remoteChainId ?? 1,
    simulateCalls: async () => ({ results: [] }),
    getTransactionCount: async () => params.pendingNonces[Math.min(nonceIndex++, params.pendingNonces.length - 1)],
    getTransactionReceipt: async () => {
      const index = receiptIndex++;
      const receipt = params.receipts[Math.min(index, params.receipts.length - 1)];
      return {
        ...receipt,
        transactionHash: index === 0 ? HASH_1 : HASH_2,
        from: WALLET,
        to: DESTINATION,
      };
    },
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: "0x12345678",
      value: 0n,
      nonce: 4 + Math.min(Math.max(receiptIndex - 1, 0), 1),
    }),
    getBlockNumber: async () => params.blocks[Math.min(blockIndex++, params.blocks.length - 1)],
  } as unknown as FxPublicClient;
}

function callbacks(signatures: Hex[], onRequest?: (index: number) => Promise<Hex>) {
  const requested: Array<{ nonce: number; to: Address }> = [];
  let index = 0;
  return {
    requested,
    requestSignature: async (request: { nonce: number; to: Address }) => {
      requested.push(request);
      if (onRequest) return onRequest(index++);
      return signatures[index++];
    },
  };
}

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());
// Node 24 exposes a native navigator.locks implementation that keeps the
// process alive after a test run. Browser tests cover Web Locks; unit tests
// exercise the deterministic in-tab fallback instead.
const nativeLocks = globalThis.navigator?.locks;
test.before(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: undefined, configurable: true });
});
test.after(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: nativeLocks, configurable: true });
});

test("runner signs SDK steps in order, waits every receipt, then performs post-read after another block", async () => {
  const events: string[] = [];
  const seenBlocks: bigint[] = [];
  const cb = callbacks([HASH_1, HASH_2]);
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4, 5],
      receipts: [
        { status: "success", blockNumber: 10n },
        { status: "success", blockNumber: 12n },
      ],
      blocks: [13n],
    }),
    callbacks: {
      requestSignature: cb.requestSignature,
      ensureChain: async (chainId) => {
        events.push(`chain:${chainId}`);
      },
      onStatus: (status, detail) => events.push(`${status}:${detail ?? ""}`),
      postConfirmRead: async (_route, confirmed) => {
        events.push(`post-read:${confirmed.steps.length}`);
        seenBlocks.push(13n);
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });

  assert.equal(result.status, "confirmed");
  assert.deepEqual(cb.requested.map((request) => request.nonce), [4, 5]);
  assert.ok(events.some((event) => event.startsWith("confirmed:All route steps")));
  assert.deepEqual(seenBlocks, [13n]);
  assert.deepEqual(readPendingHashes(), []);
});

test("runner journals bridge verification facts only on the submitted bridge action", async () => {
  const planned = route(1);
  planned.operation = "buildBridgeTx";
  planned.transactions[0] = { ...planned.transactions[0], operation: "buildBridgeTx", data: bridgeData() };
  planned.quote = {
    nativeFee: 0n,
    lzTokenFee: 0n,
    sourceOftAddress: DESTINATION,
    destinationOftAddress: "0x3333333333333333333333333333333333333333",
    destinationChainId: 8453,
    destinationEid: 30184,
    recipient: WALLET,
    recipientBytes32: `0x${"0".repeat(24)}${WALLET.slice(2)}`,
    amountLD: 1_000_000_000_000_000_000n,
    minAmountLD: 1_000_000_000_000_000_000n,
    refundAddress: WALLET,
    destinationBaselineBlock: 123n,
    bridgeToken: "fxUSD",
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
  const bridgeClient = {
    ...client({ pendingNonces: [4], receipts: [{ status: "success", blockNumber: 10n }], blocks: [] }),
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: bridgeData(),
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: planned,
    policy: {
      ...TEST_POLICY,
      allowedSelectors: { [DESTINATION.toLowerCase()]: ["0xc7c7f5b3"] },
    },
    publicClient: bridgeClient,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "confirmed");
  assert.deepEqual(readPendingHashJournal()[0]?.bridge, {
    destinationChainId: 8453,
    sourceOftAddress: DESTINATION,
    destinationOftAddress: "0x3333333333333333333333333333333333333333",
    recipient: WALLET,
    amountLD: "1000000000000000000",
    minAmountLD: "1000000000000000000",
    destinationBaselineBlock: "123",
    bridgeToken: "fxUSD",
  });
});

test("throwing UI observers cannot interrupt journaling or receipt confirmation", async () => {
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [],
    }),
    callbacks: {
      requestSignature: async () => HASH_1,
      onStatus: () => { throw new Error("render observer failed"); },
      onStep: () => { throw new Error("progress observer failed"); },
    },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(readPendingHashJournal()[0]?.status, "confirmed");
});

test("signature rejection stops the route and never requests transaction N+1", async () => {
  const cb = callbacks([], async (index) => {
    if (index === 0) throw new Error("user rejected");
    return HASH_2;
  });
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({ pendingNonces: [4], receipts: [], blocks: [] }),
    callbacks: { requestSignature: cb.requestSignature },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(cb.requested.length, 1);
  assert.equal(result.steps[0]?.status, "failed");
  assert.equal(result.steps[1], undefined);
});

test("a reverted receipt stops the following SDK transaction", async () => {
  const cb = callbacks([HASH_1, HASH_2]);
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "reverted", blockNumber: 10n }],
      blocks: [],
    }),
    callbacks: { requestSignature: cb.requestSignature },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(cb.requested.length, 1);
  assert.match(result.error ?? "", /reverted/);
});

test("a partially completed route rereads state after the confirmed prerequisite block", async () => {
  let postReads = 0;
  const cb = callbacks([], async (index) => {
    if (index === 0) return HASH_1;
    throw new Error("user rejected protocol action");
  });
  const result = await runTransactionRoute({
    route: route(2),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4, 5],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [11n],
    }),
    callbacks: {
      requestSignature: cb.requestSignature,
      postConfirmRead: async (_route, partial) => {
        postReads += 1;
        assert.equal(partial.status, "partial");
        assert.equal(partial.steps[0]?.status, "confirmed");
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });
  assert.equal(result.status, "partial");
  assert.equal(cb.requested.length, 2);
  assert.equal(postReads, 1);
});

test("nonce drift prevents signing before the wallet prompt", async () => {
  let signatures = 0;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({ pendingNonces: [99], receipts: [], blocks: [] }),
    callbacks: {
      requestSignature: async () => {
        signatures += 1;
        return HASH_1;
      },
    },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.equal(signatures, 0);
  assert.match(result.error ?? "", /nonce drift/);
});

test("a live RPC chain mismatch fails before opening a wallet prompt", async () => {
  let signatures = 0;
  await assert.rejects(
    runTransactionRoute({
      route: route(1),
      policy: TEST_POLICY,
      publicClient: client({ pendingNonces: [4], receipts: [], blocks: [], remoteChainId: 8453 }),
      callbacks: {
        requestSignature: async () => {
          signatures += 1;
          return HASH_1;
        },
      },
      options: { simulate: false, waitForNextBlock: false },
    }),
    /returned chain 8453; expected 1/,
  );
  assert.equal(signatures, 0);
  assert.deepEqual(readPendingHashJournal(), []);
});

test("runner rejects a mined transaction whose provider returns another hash", async () => {
  const base = client({
    pendingNonces: [4],
    receipts: [{ status: "success", blockNumber: 10n }],
    blocks: [],
  });
  const hostile = {
    ...base,
    getTransaction: async () => ({
      hash: HASH_2,
      from: WALLET,
      to: DESTINATION,
      input: "0x12345678",
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: hostile,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /mined transaction hash/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner leaves a signed hash pending when the receipt block is malformed", async () => {
  const base = client({ pendingNonces: [4], receipts: [], blocks: [] });
  const malformed = {
    ...base,
    getTransactionReceipt: async () => ({
      transactionHash: HASH_1,
      from: WALLET,
      to: DESTINATION,
      status: "success",
      blockNumber: undefined,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: malformed,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /canonical block number/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner leaves a signed hash pending when the receipt status is non-terminal", async () => {
  const base = client({ pendingNonces: [4], receipts: [], blocks: [] });
  const malformed = {
    ...base,
    getTransactionReceipt: async () => ({
      transactionHash: HASH_1,
      from: WALLET,
      to: DESTINATION,
      status: "pending",
      blockNumber: 10n,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: malformed,
    callbacks: { requestSignature: async () => HASH_1 },
    options: { simulate: false, waitForNextBlock: false },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /terminal on-chain status/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("runner does not mark a receipt confirmed when mined calldata is mutated", async () => {
  let signatures = 0;
  let postReads = 0;
  const base = client({
    pendingNonces: [4],
    receipts: [{ status: "success", blockNumber: 10n }],
    blocks: [11n],
  });
  const hostile = {
    ...base,
    getTransaction: async ({ hash }: { hash: Hex }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: "0xdeadbeef",
      value: 0n,
      nonce: 4,
    }),
  } as unknown as FxPublicClient;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: hostile,
    callbacks: {
      requestSignature: async () => {
        signatures += 1;
        return HASH_1;
      },
      postConfirmRead: async (_route, failed) => {
        postReads += 1;
        assert.equal(failed.status, "failed");
        assert.equal(failed.steps[0]?.receipt?.blockNumber, 10n);
      },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 100 },
  });
  assert.equal(signatures, 1);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /calldata/);
  assert.equal(result.steps[0]?.status, "failed");
  assert.equal(postReads, 1);
});

test("simulation fails closed when the RPC omits an ordered route result", async () => {
  const partialClient = {
    chain: { id: 1 },
    getChainId: async () => 1,
    simulateCalls: async () => ({ results: [{ status: "success" }] }),
  } as unknown as FxPublicClient;
  const result = await simulatePlannedRoute(route(2), partialClient);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /returned 1 results for 2 transactions/);
});

test("post-confirm reads are skipped when the required next block is unavailable", async () => {
  let postReads = 0;
  const result = await runTransactionRoute({
    route: route(1),
    policy: TEST_POLICY,
    publicClient: client({
      pendingNonces: [4],
      receipts: [{ status: "success", blockNumber: 10n }],
      blocks: [10n],
    }),
    callbacks: {
      requestSignature: async () => HASH_1,
      postConfirmRead: async () => { postReads += 1; },
    },
    options: { simulate: false, pollMs: 0, receiptTimeoutMs: 2 },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(postReads, 0);
});
