/**
 * W-11 — idempotency, tx state machine, EIP-1559 fees, receipt watching.
 * Chain + Privy are mocked; the live-fork pass is Phase 4 (Anvil).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxbot/db";
import {
  TX_STATES,
  isTerminal,
  canTransition,
  assertTransition,
  isTxState,
} from "../src/core/txState.js";
import {
  getEip1559Fees,
  medianBigint,
  clampBigint,
  MIN_PRIORITY_FEE_WEI,
  MAX_PRIORITY_FEE_WEI,
} from "../src/core/fees.js";
import { executeRoute, waitForReceipt } from "../src/core/txExecutor.js";
import type { TradeTx } from "../src/fx/index.js";

// ── Mock the chain + Privy layers ──────────────────────────────────────────
const simulateRouteMock = vi.fn();
vi.mock("../src/fx/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, simulateRoute: (...a: unknown[]) => simulateRouteMock(...a) };
});
const sendTxMock = vi.fn();
vi.mock("../src/core/privy.js", () => ({
  sendWalletTransaction: (...a: unknown[]) => sendTxMock(...a),
}));

const GWEI = 1_000_000_000n;

function feeClient(baseFees: bigint[], rewards: bigint[][]) {
  return {
    getFeeHistory: vi.fn(async () => ({
      baseFeePerGas: baseFees,
      gasUsedRatio: [],
      oldestBlock: 0n,
      reward: rewards,
    })),
  };
}

function receiptClient(outcomes: Array<"success" | "reverted" | "pending">) {
  let i = 0;
  return {
    getTransactionReceipt: vi.fn(async () => {
      const o = outcomes[Math.min(i++, outcomes.length - 1)];
      if (o === "pending") throw new Error("receipt not found");
      return { status: o === "success" ? "success" : "reverted" };
    }),
  };
}

const TXS: TradeTx[] = [
  { to: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", data: "0x01", value: 0n },
  { to: "0x33636D49FbefBE798e15e7F356E8DBef543CC708", data: "0x02", value: 0n },
];

function baseParams(client: unknown, key = "trade:1:abc") {
  return {
    userId: "user-1",
    walletId: "wal-1",
    walletAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as const,
    idempotencyKey: key,
    txs: TXS,
    type: "open_long",
    client: client as never,
    watch: { pollMs: 1, timeoutMs: 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // default DB behavior: no existing record, create/update succeed
  (prisma.txRecord as unknown as Record<string, ReturnType<typeof vi.fn>>) = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({
      id: "rec-1",
      ...data,
    })),
    update: vi.fn().mockResolvedValue({}),
  };
  simulateRouteMock.mockResolvedValue({ success: true, gasUsed: [50_000n, 400_000n], totalGas: 450_000n });
  sendTxMock
    .mockResolvedValueOnce({ hash: "0x" + "a".repeat(64) })
    .mockResolvedValueOnce({ hash: "0x" + "b".repeat(64) });
});

describe("txState machine", () => {
  it("declares exactly the audited states and terminality", () => {
    expect([...TX_STATES]).toEqual([
      "prepared", "simulated", "broadcasting", "broadcast", "confirmed", "reverted", "failed",
    ]);
    for (const s of ["confirmed", "reverted", "failed"] as const) expect(isTerminal(s)).toBe(true);
    for (const s of ["prepared", "simulated", "broadcasting", "broadcast"] as const)
      expect(isTerminal(s)).toBe(false);
  });

  it("forbids skipping simulation and resurrecting terminal states", () => {
    expect(canTransition("prepared", "broadcasting")).toBe(false);
    expect(canTransition("prepared", "broadcast")).toBe(false);
    expect(canTransition("failed", "prepared")).toBe(false);
    expect(canTransition("confirmed", "broadcast")).toBe(false);
    // once broadcast, never 'failed' on a hunch — only confirmed/reverted
    expect(canTransition("broadcast", "failed")).toBe(false);
    expect(() => assertTransition("broadcast", "failed")).toThrow(/illegal/);
  });

  it("accepts the happy path and validates strings", () => {
    assertTransition("prepared", "simulated");
    assertTransition("simulated", "broadcasting");
    assertTransition("broadcasting", "broadcast");
    assertTransition("broadcast", "confirmed");
    expect(isTxState("confirmed")).toBe(true);
    expect(isTxState("CONFIRMED")).toBe(false);
  });
});

describe("EIP-1559 fees from feeHistory", () => {
  it("uses next-block base fee and median tip: maxFee = 2*base + tip", async () => {
    const client = feeClient(
      [10n * GWEI, 11n * GWEI, 12n * GWEI],
      [[1n * GWEI], [3n * GWEI], [2n * GWEI]]
    );
    const fees = await getEip1559Fees(client as never);
    expect(fees.nextBaseFee).toBe(12n * GWEI);
    expect(fees.maxPriorityFeePerGas).toBe(2n * GWEI); // median of 1,3,2
    expect(fees.maxFeePerGas).toBe(2n * 12n * GWEI + 2n * GWEI);
  });

  it("clamps the tip to [0.1, 10] gwei and floors empty rewards", async () => {
    const spiky = await getEip1559Fees(feeClient([5n * GWEI], [[500n * GWEI]]) as never);
    expect(spiky.maxPriorityFeePerGas).toBe(MAX_PRIORITY_FEE_WEI);
    const empty = await getEip1559Fees(feeClient([5n * GWEI], []) as never);
    expect(empty.maxPriorityFeePerGas).toBe(MIN_PRIORITY_FEE_WEI);
  });

  it("refuses to guess when feeHistory is unusable", async () => {
    await expect(getEip1559Fees(feeClient([], []) as never)).rejects.toThrow(/refusing to guess/);
  });

  it("bigint helpers are exact", () => {
    expect(medianBigint([5n, 1n, 3n])).toBe(3n);
    expect(medianBigint([4n, 2n])).toBe(3n);
    expect(() => medianBigint([])).toThrow();
    expect(clampBigint(5n, 1n, 3n)).toBe(3n);
    expect(clampBigint(0n, 1n, 3n)).toBe(1n);
  });
});

describe("executeRoute", () => {
  const fee = feeClient([10n * GWEI, 12n * GWEI], [[2n * GWEI]]);

  it("happy path: simulate → fees → broadcast each tx → confirmed", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    const res = await executeRoute(baseParams(client));
    expect(res).toMatchObject({ ok: true, deduped: false, status: "confirmed" });
    if (!res.ok) throw new Error("unreachable");
    expect(res.hashes).toHaveLength(2);
    expect(simulateRouteMock).toHaveBeenCalledTimes(1);
    expect(sendTxMock).toHaveBeenCalledTimes(2);
    // EIP-1559 type-2 with hex bigint fees and 20% gas headroom on tx 1
    const firstTx = sendTxMock.mock.calls[0][1];
    expect(firstTx).toMatchObject({ type: 2, chainId: 1 });
    expect(BigInt(firstTx.gasLimit)).toBe(60_000n); // 50k * 1.2
    expect(BigInt(firstTx.maxPriorityFeePerGas)).toBe(2n * GWEI);
  });

  it("is idempotent: an existing in-flight/confirmed key never re-broadcasts", async () => {
    (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rec-0",
      status: "broadcast",
      data: { hashes: ["0x" + "c".repeat(64)] },
    });
    const res = await executeRoute(baseParams(fee));
    expect(res).toMatchObject({ ok: true, deduped: true, status: "broadcast" });
    expect(sendTxMock).not.toHaveBeenCalled();
    expect(simulateRouteMock).not.toHaveBeenCalled();
  });

  it("a failed prior attempt demands a NEW key (no silent resurrection)", async () => {
    (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rec-0",
      status: "failed",
      data: { hashes: [] },
    });
    const res = await executeRoute(baseParams(fee));
    expect(res).toMatchObject({ ok: false, deduped: true, status: "failed" });
    expect(res.ok ? "" : res.error).toMatch(/new idempotency key/);
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("fail-closed: failed simulation never broadcasts", async () => {
    simulateRouteMock.mockResolvedValue({ success: false, error: "would revert", failedTxIndex: 1 });
    const res = await executeRoute(baseParams(fee));
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(res.ok ? "" : res.error).toMatch(/simulation failed at tx 1/);
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("fee-estimation failure aborts before broadcast", async () => {
    const badFee = { getFeeHistory: vi.fn().mockRejectedValue(new Error("rpc down")) };
    const res = await executeRoute(baseParams(badFee));
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("an on-chain revert marks the record reverted and stops the route", async () => {
    const client = { ...fee, ...receiptClient(["reverted"]) };
    const res = await executeRoute(baseParams(client));
    expect(res).toMatchObject({ ok: false, status: "reverted" });
    expect(sendTxMock).toHaveBeenCalledTimes(1); // router call never sent
  });

  it("a watcher timeout leaves the honest 'broadcast' state (never failed)", async () => {
    const client = { ...fee, ...receiptClient(["pending"]) };
    const res = await executeRoute(baseParams(client));
    expect(res).toMatchObject({ ok: false, status: "broadcast" });
    expect(res.ok ? "" : res.error).toMatch(/not mined within watch window/);
  });

  it("emits status callbacks along the way", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    const seen: string[] = [];
    await executeRoute({ ...baseParams(client), onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(["simulated", "broadcasting", "broadcast", "confirmed"]);
  });
});

describe("waitForReceipt", () => {
  it("polls through pending until mined", async () => {
    const client = receiptClient(["pending", "pending", "success"]);
    await expect(
      waitForReceipt(client as never, "0xabc" as never, { pollMs: 1, timeoutMs: 1000 })
    ).resolves.toBe("confirmed");
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(3);
  });

  it("returns timeout instead of guessing", async () => {
    const client = receiptClient(["pending"]);
    await expect(
      waitForReceipt(client as never, "0xabc" as never, { pollMs: 5, timeoutMs: 20 })
    ).resolves.toBe("timeout");
  });
});
