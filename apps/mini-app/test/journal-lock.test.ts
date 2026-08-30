import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import {
  clearPendingHashJournalForTests,
  readPendingHashJournal,
  readPendingHashes,
  recordPendingHash,
  reconcilePendingHashes,
} from "../src/lib/fx/journal";
import { withWalletChainLock } from "../src/lib/fx/lock";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const HASH = `0x${"a".repeat(64)}` as Hex;

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());
const nativeLocks = globalThis.navigator?.locks;
test.before(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: undefined, configurable: true });
});
test.after(() => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "locks", { value: nativeLocks, configurable: true });
});

test("the pending journal is a receipt cache, not a protocol or authorization source", async () => {
  recordPendingHash({
    operation: "buildBridgeTx",
    walletAddress: WALLET,
    chainId: 1,
    hash: HASH,
    to: "0x3333333333333333333333333333333333333333",
    nonce: 7,
    data: "0x12345678",
    value: 0n,
  });
  assert.equal(readPendingHashes().length, 1);
  assert.equal(readPendingHashJournal()[0]?.status, "pending");

  let receiptChecks = 0;
  await reconcilePendingHashes({
    getReceiptStatus: async (record) => {
      receiptChecks += 1;
      assert.equal(record.hash, HASH);
      return "pending";
    },
  });
  assert.equal(receiptChecks, 1);
  assert.equal(readPendingHashes().length, 1);

  await reconcilePendingHashes({ getReceiptStatus: async () => "confirmed" });
  assert.equal(readPendingHashes().length, 0);
  assert.equal(readPendingHashJournal()[0]?.status, "confirmed");
});

test("the journal ignores forged records outside the official method scope", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  localStorage.setItem("fxaeon:pending-hashes:v4", JSON.stringify([
    {
      id: "forged",
      operation: "serverExecute",
      walletAddress: WALLET,
      chainId: 1,
      hash: `0x${"b".repeat(64)}`,
      to: "0x3333333333333333333333333333333333333333",
      submittedAt: Date.now(),
      status: "pending",
    },
  ]));
  try {
    assert.deepEqual(readPendingHashes(), []);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("the pending journal keeps an in-memory copy when localStorage reads or writes fail", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const localStorage = {
    getItem: () => { throw new Error("storage read blocked"); },
    setItem: () => { throw new Error("storage write blocked"); },
    removeItem: () => { throw new Error("storage remove blocked"); },
  } as unknown as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    const record = recordPendingHash({
      operation: "buildBridgeTx",
      walletAddress: WALLET,
      chainId: 1,
      hash: HASH,
      to: "0x3333333333333333333333333333333333333333",
      nonce: 7,
      data: "0x12345678",
      value: 0n,
    });
    assert.equal(record.status, "pending");
    // Both reads and writes have failed, but the validated memory fallback
    // still exposes the signed hash for receipt reconciliation.
    assert.deepEqual(readPendingHashes(), [record]);
    assert.deepEqual(readPendingHashJournal(), [record]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("bridge recovery context is JSON-safe and rejected when malformed", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    const valid = recordPendingHash({
      operation: "buildBridgeTx",
      walletAddress: WALLET,
      chainId: 1,
      hash: HASH,
      to: "0x3333333333333333333333333333333333333333",
      nonce: 7,
      data: "0x12345678",
      value: 0n,
      bridge: {
        destinationChainId: 8453,
        sourceOftAddress: "0x3333333333333333333333333333333333333333",
        destinationOftAddress: "0x5555555555555555555555555555555555555555",
        recipient: "0x6666666666666666666666666666666666666666",
        amountLD: "1000000000000000000",
        minAmountLD: "999900000000000000",
        destinationBaselineBlock: "123",
        bridgeToken: "fxUSD",
      },
    });
    assert.deepEqual(readPendingHashJournal()[0]?.bridge, valid.bridge);

    const malformed = { ...valid, id: "malformed", hash: `0x${"c".repeat(64)}`, bridge: { ...valid.bridge, minAmountLD: "2000000000000000000" } };
    localStorage.setItem("fxaeon:pending-hashes:v4", JSON.stringify([malformed]));
    // Untrusted legacy input is ignored without erasing the independently
    // recorded, validated pending hash already held by this tab.
    assert.deepEqual(readPendingHashJournal(), [valid]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("append-only record keys preserve concurrent Ethereum and Base hashes", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  } as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    const ethereum = recordPendingHash({
      operation: "increasePosition",
      walletAddress: WALLET,
      chainId: 1,
      hash: HASH,
      to: "0x3333333333333333333333333333333333333333",
      nonce: 7,
      data: "0x12345678",
      value: 0n,
    });
    const baseHash = `0x${"b".repeat(64)}` as Hex;
    const base = recordPendingHash({
      operation: "buildBridgeTx",
      walletAddress: WALLET,
      chainId: 8453,
      hash: baseHash,
      to: "0x4444444444444444444444444444444444444444",
      nonce: 2,
      data: "0xabcdef12",
      value: 1n,
    });
    assert.deepEqual(new Set(readPendingHashJournal().map((record) => record.id)), new Set([ethereum.id, base.id]));
    assert.equal([...values.keys()].filter((key) => key.startsWith("fxaeon:pending-event:v6:")).length, 2);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("bridge context is accepted only for the exact submitted bridge OFT", () => {
  const bridge = {
    destinationChainId: 8453 as const,
    sourceOftAddress: "0x3333333333333333333333333333333333333333" as Address,
    destinationOftAddress: "0x5555555555555555555555555555555555555555" as Address,
    recipient: "0x6666666666666666666666666666666666666666" as Address,
    amountLD: "1000000000000000000",
    minAmountLD: "999900000000000000",
    destinationBaselineBlock: "123",
    bridgeToken: "fxUSD",
  };
  assert.throws(() => recordPendingHash({
    operation: "increasePosition",
    walletAddress: WALLET,
    chainId: 1,
    hash: HASH,
    to: bridge.sourceOftAddress,
    data: "0x12345678",
    value: 0n,
    bridge,
  }), /bridge recovery context/);
  assert.throws(() => recordPendingHash({
    operation: "buildBridgeTx",
    walletAddress: WALLET,
    chainId: 1,
    hash: HASH,
    to: "0x7777777777777777777777777777777777777777",
    data: "0x12345678",
    value: 0n,
    bridge,
  }), /bridge recovery context/);
});

test("legacy journal records remain recoverable and migrate on receipt status update", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  } as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    const submittedAt = Date.now();
    const legacy = {
      id: `1:${WALLET.toLowerCase()}:${HASH.toLowerCase()}`,
      operation: "increasePosition",
      walletAddress: WALLET,
      chainId: 1,
      hash: HASH,
      to: "0x3333333333333333333333333333333333333333",
      submittedAt,
      status: "pending",
    };
    values.set("fxaeon:pending-hashes:v4", JSON.stringify([legacy]));
    assert.equal(readPendingHashJournal()[0]?.hash, HASH);
    await reconcilePendingHashes({ getReceiptStatus: async () => "confirmed" });
    assert.equal(readPendingHashJournal()[0]?.status, "confirmed");
    assert.ok([...values.keys()].some((key) => key.startsWith("fxaeon:pending-event:v6:")));
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("the wallet-chain lock serializes concurrent signing flows", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const first = withWalletChainLock({
    walletAddress: WALLET,
    chainId: 1,
    run: async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push("first:end");
      return "first";
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = withWalletChainLock({
    walletAddress: WALLET,
    chainId: 1,
    run: async () => {
      events.push("second:start");
      events.push("second:end");
      return "second";
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("the wallet lock serializes Ethereum and Base flows for the same external wallet", async () => {
  const events: string[] = [];
  let releaseEthereum!: () => void;
  const ethereum = withWalletChainLock({
    walletAddress: WALLET,
    chainId: 1,
    run: async () => {
      events.push("ethereum:start");
      await new Promise<void>((resolve) => { releaseEthereum = resolve; });
      events.push("ethereum:end");
      return "ethereum";
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const base = withWalletChainLock({
    walletAddress: WALLET,
    chainId: 8453,
    run: async () => {
      events.push("base:start");
      events.push("base:end");
      return "base";
    },
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["ethereum:start"]);
  releaseEthereum();
  assert.deepEqual(await Promise.all([ethereum, base]), ["ethereum", "base"]);
  assert.deepEqual(events, ["ethereum:start", "ethereum:end", "base:start", "base:end"]);
});

test("the storage lease preserves the original route error", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
  });
  try {
    await assert.rejects(
      withWalletChainLock({
        walletAddress: WALLET,
        chainId: 1,
        ttlMs: 1_000,
        run: async () => { throw new Error("simulation rejected the route"); },
      }),
      /simulation rejected the route/,
    );
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("the storage lease exposes an ownership guard and fails closed after expiry", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  try {
    await assert.rejects(
      withWalletChainLock({
        walletAddress: WALLET,
        chainId: 1,
        ttlMs: 1_000,
        run: async (assertOwned) => {
          assertOwned();
          const lockKey = [...values.keys()].find((key) => key.startsWith("fxaeon:tx-lock:v1:"));
          assert.ok(lockKey);
          values.set(lockKey!, JSON.stringify({ owner: "another-tab", expiresAt: Date.now() + 10_000 }));
          assert.throws(assertOwned, /ownership was lost/);
          throw new Error("lock guard rejected the route");
        },
      }),
      /lock guard rejected the route/,
    );
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("browser financial signing can require authoritative Web Locks", async () => {
  await assert.rejects(
    withWalletChainLock({
      walletAddress: WALLET,
      chainId: 1,
      requireWebLocks: true,
      run: async () => "must not run",
    }),
    /cannot safely serialize wallet approvals/,
  );
});
