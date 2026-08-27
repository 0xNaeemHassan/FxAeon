import assert from "node:assert/strict";
import { test } from "node:test";
import { TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import {
  clearPendingHashJournalForTests,
  readPendingHashJournal,
  recordPendingHash,
  updatePendingHash,
} from "../src/lib/fx/journal";
import {
  explorerTransactionUrl,
  filterJournalForWallet,
  reconcileWalletJournal,
  selectRecoveryRecords,
} from "../src/lib/fx/recovery";
import type { FxPublicClient, PendingHashRecord } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as Address;
const DESTINATION = "0x3333333333333333333333333333333333333333" as Address;
const HASH = `0x${"a".repeat(64)}` as Hex;
const OTHER_HASH = `0x${"b".repeat(64)}` as Hex;
const DATA = "0x12345678" as Hex;

function addRecord(params: {
  walletAddress?: Address;
  chainId?: 1 | 8453;
  hash?: Hex;
} = {}): PendingHashRecord {
  return recordPendingHash({
    operation: "buildBridgeTx",
    walletAddress: params.walletAddress ?? WALLET,
    chainId: params.chainId ?? 1,
    hash: params.hash ?? HASH,
    to: DESTINATION,
    nonce: 4,
    data: DATA,
    value: 0n,
  });
}

function receipt(record: PendingHashRecord, overrides: Record<string, unknown> = {}) {
  return {
    transactionHash: record.hash,
    from: record.walletAddress,
    to: DESTINATION,
    status: "success",
    blockNumber: 123n,
    ...overrides,
  } as never;
}

function client(
  getTransactionReceipt: FxPublicClient["getTransactionReceipt"],
  chainId?: 1 | 8453,
  getTransaction?: FxPublicClient["getTransaction"],
): FxPublicClient {
  return {
    chain: chainId === undefined ? undefined : { id: chainId },
    getChainId: async () => chainId ?? 1,
    getTransactionReceipt,
    getTransaction: getTransaction ?? (async ({ hash }) => ({
      hash,
      from: WALLET,
      to: DESTINATION,
      input: DATA,
      value: 0n,
      nonce: 4,
    }) as never),
  } as unknown as FxPublicClient;
}

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());

test("filters journal entries by the exact selected wallet, case-insensitively", () => {
  const first = addRecord();
  const other = addRecord({ walletAddress: OTHER_WALLET, hash: OTHER_HASH });

  assert.deepEqual(
    filterJournalForWallet([first, other], `0x${WALLET.slice(2).toUpperCase()}`),
    [first],
  );
  assert.deepEqual(filterJournalForWallet([first, other], undefined), []);
});

test("reconciles with the public client for each record's chain and persists only receipt truth", async () => {
  const ethereum = addRecord({ chainId: 1 });
  const base = addRecord({ chainId: 8453, hash: OTHER_HASH });
  const requestedChains: number[] = [];

  const views = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: (chainId) => {
      requestedChains.push(chainId);
      return client(async ({ hash }) => receipt(hash === ethereum.hash ? ethereum : base), chainId);
    },
  });

  assert.deepEqual(requestedChains.sort((a, b) => a - b), [1, 8453]);
  assert.deepEqual(views.map((view) => view.status), ["confirmed", "confirmed"]);
  assert.ok(readPendingHashJournal().every((record) => record.status === "confirmed"));
  assert.equal(views[0]?.verification, "receipt");
  assert.equal(explorerTransactionUrl(8453, OTHER_HASH), `https://basescan.org/tx/${OTHER_HASH}`);
});

test("never ages unresolved records out of recovery", async () => {
  for (let index = 0; index < 12; index += 1) {
    addRecord({ hash: `0x${index.toString(16).padStart(64, "0")}` as Hex });
  }
  let reads = 0;
  const views = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async ({ hash }) => {
      reads += 1;
      const record = readPendingHashJournal().find((candidate) => candidate.hash === hash)!;
      return receipt(record);
    }, 1),
  });

  assert.equal(reads, 12);
  assert.equal(views.length, 12);
});

test("caps only terminal non-bridge history while preserving every unresolved record", () => {
  for (let index = 0; index < 12; index += 1) {
    const hash = `0x${index.toString(16).padStart(64, "0")}` as Hex;
    addRecord({ hash });
    updatePendingHash(hash, "confirmed");
  }
  const pendingA = addRecord({ hash: `0x${"c".repeat(64)}` as Hex });
  const pendingB = addRecord({ hash: `0x${"d".repeat(64)}` as Hex, chainId: 8453 });
  const selected = selectRecoveryRecords(readPendingHashJournal(), WALLET);
  assert.equal(selected.length, 10);
  assert.ok(selected.some((record) => record.id === pendingA.id));
  assert.ok(selected.some((record) => record.id === pendingB.id));
  assert.equal(selected.filter((record) => record.status !== "pending").length, 8);
});

test("a missing receipt remains pending even when local storage says confirmed", async () => {
  const record = addRecord();
  updatePendingHash(record.hash, "confirmed");

  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => {
      throw new TransactionReceiptNotFoundError({ hash: record.hash });
    }, 1),
  });

  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "not-found");
  assert.equal(readPendingHashJournal()[0]?.status, "confirmed");
});

test("an RPC failure is pending and retryable, never a false failure", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => {
      throw new Error("Alchemy temporarily unavailable");
    }, 1),
  });

  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "rpc-error");
  assert.match(view?.message ?? "", /Nothing was marked failed/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a live RPC chain mismatch cannot verify a local recovery record", async () => {
  const record = addRecord();
  const mismatched = {
    ...client(async () => receipt(record), 1),
    getChainId: async () => 8453,
  } as unknown as FxPublicClient;
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => mismatched,
  });
  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "rpc-error");
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a receipt from another sender is not accepted as this wallet's confirmation", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => receipt(record, { from: OTHER_WALLET }), 1),
  });

  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a receipt sent to another contract is not accepted as the reviewed transaction", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => receipt(record, { to: OTHER_WALLET }), 1),
  });

  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a malformed non-terminal receipt is not interpreted as a revert", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => receipt(record, { status: "pending" }), 1),
  });

  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a receipt without a canonical block number remains unverified", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => receipt(record, { blockNumber: undefined }), 1),
  });
  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("a reverted receipt is explicitly failed on-chain", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(async () => receipt(record, { status: "reverted" }), 1),
  });

  assert.equal(view?.status, "failed");
  assert.equal(view?.verification, "receipt");
  assert.match(view?.message ?? "", /reverted on-chain/);
  assert.equal(readPendingHashJournal()[0]?.status, "failed");
});

test("recovery rejects a successful receipt whose mined calldata changed", async () => {
  const record = addRecord();
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    getClient: () => client(
      async () => receipt(record),
      1,
      async ({ hash }) => ({ hash, from: WALLET, to: DESTINATION, input: "0xdeadbeef", value: 0n, nonce: 4 }) as never,
    ),
  });
  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.match(view?.message ?? "", /calldata/);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");
});

test("legacy recovery records without a reviewed fingerprint remain unverified", async () => {
  const record = addRecord();
  const legacy = { ...record, dataHash: undefined, valueWei: undefined, nonce: undefined };
  const [view] = await reconcileWalletJournal({
    walletAddress: WALLET,
    records: [legacy],
    getClient: () => client(async () => receipt(legacy), 1),
  });
  assert.equal(view?.status, "pending");
  assert.equal(view?.verification, "mismatch");
  assert.match(view?.message ?? "", /older recovery entry/);
});
