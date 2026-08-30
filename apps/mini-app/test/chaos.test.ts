import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { clearPendingHashJournalForTests } from "../src/lib/fx/journal";
import { runTransactionRoute } from "../src/lib/fx/runner";
import { validateRoute } from "../src/lib/fx/validation";
import type {
  FxPublicClient,
  PlannedRoute,
  PlannedTransaction,
  TransactionPolicy,
} from "../src/lib/fx/types";

/**
 * Deterministic property-style tests for the two highest-risk boundaries:
 * reviewed route validation and ordered wallet execution.  The seed and
 * iteration count are intentionally environment-configurable so CI can run a
 * larger campaign without making the default developer run unpredictable.
 */
const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const EVIL_WALLET = "0x9999999999999999999999999999999999999999" as Address;
const DESTINATION = "0x2222222222222222222222222222222222222222" as Address;
const EVIL_DESTINATION = "0x3333333333333333333333333333333333333333" as Address;
const DATA = "0x12345678" as Hex;
const HASH_PREFIX = "0x";

const TEST_POLICY: TransactionPolicy = {
  walletAddress: WALLET,
  chainId: 1,
  allowedDestinations: [DESTINATION],
  allowedSelectors: { [DESTINATION.toLowerCase()]: [DATA.slice(0, 10)] },
  maxValueWei: 0n,
};

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    // xorshift32: fast, deterministic, and sufficient for adversarial input
    // selection (this is not used for keys, signatures, or financial values).
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function envInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function baseRoute(count = 4): PlannedRoute {
  return {
    operation: "increasePosition",
    chainId: 1,
    walletAddress: WALLET,
    transactions: Array.from({ length: count }, (_, index): PlannedTransaction => ({
      chainId: 1,
      from: WALLET,
      to: DESTINATION,
      data: DATA,
      value: 0n,
      nonce: index,
      kind: "action",
      operation: "increasePosition",
    })),
  };
}

type Mutation =
  | "route-wallet"
  | "route-chain"
  | "sender"
  | "destination"
  | "selector"
  | "positive-value"
  | "negative-value"
  | "operation"
  | "nonce-gap"
  | "empty-route"
  | "approve-classification";

const MUTATIONS: readonly Mutation[] = [
  "route-wallet",
  "route-chain",
  "sender",
  "destination",
  "selector",
  "positive-value",
  "negative-value",
  "operation",
  "nonce-gap",
  "empty-route",
  "approve-classification",
];

function mutate(route: PlannedRoute, mutation: Mutation): PlannedRoute {
  const transactions = route.transactions.map((transaction) => ({ ...transaction }));
  switch (mutation) {
    case "route-wallet":
      return { ...route, walletAddress: EVIL_WALLET };
    case "route-chain":
      return {
        ...route,
        chainId: 8453,
        transactions: transactions.map((transaction) => ({ ...transaction, chainId: 8453 })),
      };
    case "sender":
      transactions[0].from = EVIL_WALLET;
      return { ...route, transactions };
    case "destination":
      transactions[0].to = EVIL_DESTINATION;
      return { ...route, transactions };
    case "selector":
      transactions[0].data = "0xdeadbeef";
      return { ...route, transactions };
    case "positive-value":
      transactions[0].value = 1n;
      return { ...route, transactions };
    case "negative-value":
      transactions[0].value = -1n;
      return { ...route, transactions };
    case "operation":
      transactions[0].operation = "reducePosition";
      return { ...route, transactions };
    case "nonce-gap":
      transactions[1].nonce = 99;
      return { ...route, transactions };
    case "empty-route":
      return { ...route, transactions: [] };
    case "approve-classification":
      transactions[0].data = "0x095ea7b3";
      return { ...route, transactions };
  }
}

function hashFor(iteration: number, index: number): Hex {
  const value = BigInt(iteration * 8 + index + 1).toString(16).padStart(64, "0");
  return `${HASH_PREFIX}${value}` as Hex;
}

test.before(() => {
  // Node 24 may expose navigator.locks, whose native implementation keeps a
  // worker alive after tests. Browser E2E covers the real Web Locks path.
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, "locks", { value: undefined, configurable: true });
  }
});

test.beforeEach(() => clearPendingHashJournalForTests());
test.afterEach(() => clearPendingHashJournalForTests());

test("seeded route chaos rejects every mutated authority invariant", () => {
  const seed = Number.parseInt(process.env.FX_CHAOS_SEED ?? "15728640", 10) >>> 0;
  const iterations = envInteger("FX_CHAOS_ITERATIONS", 2_000, 20_000);
  const random = seededRandom(seed);
  const valid = baseRoute();
  assert.doesNotThrow(() => validateRoute(valid, TEST_POLICY));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const mutation = MUTATIONS[Math.floor(random() * MUTATIONS.length)];
    const candidate = mutate(valid, mutation);
    assert.throws(
      () => validateRoute(candidate, TEST_POLICY),
      /./,
      `seed=${seed} iteration=${iteration} mutation=${mutation} unexpectedly passed validation`,
    );
  }
});

test("seeded runner chaos stops signing after rejection, revert, or RPC failure", async () => {
  const seed = Number.parseInt(process.env.FX_CHAOS_SEED ?? "15728640", 10) >>> 0;
  const iterations = envInteger("FX_CHAOS_RUNNER_ITERATIONS", 600, 10_000);
  const random = seededRandom(seed ^ 0xa5a5a5a5);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const route = baseRoute();
    const mode = Math.floor(random() * 4) as 0 | 1 | 2 | 3;
    const failureIndex = mode === 0 ? -1 : Math.floor(random() * route.transactions.length);
    let signatureIndex = 0;
    let nonceReads = 0;
    const signed: number[] = [];
    const receipts = new Map<string, "success" | "reverted">();
    const client: FxPublicClient = {
      chain: { id: 1 },
      getChainId: async () => 1,
      simulateCalls: async () => ({ results: [] }),
      getTransactionCount: async () => nonceReads++,
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const status = receipts.get(hash.toLowerCase());
        if (!status) throw new Error("synthetic RPC outage");
        return {
          transactionHash: hash,
          from: WALLET,
          to: DESTINATION,
          status,
          blockNumber: BigInt(iteration + 1),
        } as never;
      },
      getTransaction: async ({ hash }: { hash: Hex }) => {
        const index = Number(BigInt(hash) - 1n) % 8;
        return {
          hash,
          from: WALLET,
          to: DESTINATION,
          input: DATA,
          value: 0n,
          nonce: index,
        } as never;
      },
      getBlockNumber: async () => BigInt(iteration + 2),
    } as unknown as FxPublicClient;

    const result = await runTransactionRoute({
      route,
      policy: TEST_POLICY,
      publicClient: client,
      callbacks: {
        requestSignature: async (request) => {
          const index = signatureIndex++;
          signed.push(index);
          if (index === failureIndex && mode === 1) throw new Error("synthetic wallet rejection");
          const hash = hashFor(iteration, index);
          if (index === failureIndex && mode === 2) receipts.set(hash.toLowerCase(), "reverted");
          if (mode === 0 || index !== failureIndex) receipts.set(hash.toLowerCase(), "success");
          return hash;
        },
      },
      options: { simulate: false, waitForNextBlock: false, receiptTimeoutMs: 2, pollMs: 0 },
    });

    const expectedSigned = failureIndex < 0 ? route.transactions.length : failureIndex + 1;
    assert.equal(signed.length, expectedSigned, `seed=${seed} iteration=${iteration} mode=${mode}`);
    assert.deepEqual(signed, Array.from({ length: expectedSigned }, (_, index) => index));
    if (mode === 0) {
      assert.equal(result.status, "confirmed", `seed=${seed} iteration=${iteration}`);
      assert.equal(result.steps.every((step) => step.status === "confirmed"), true);
    } else {
      assert.equal(result.status, failureIndex > 0 ? "partial" : "failed");
      assert.equal(result.steps.length, expectedSigned);
      assert.equal(result.steps.at(-1)?.status, "failed");
    }
  }
});
