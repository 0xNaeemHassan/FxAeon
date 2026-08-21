/**
 * W-11 — idempotency, tx state machine, EIP-1559 fees, receipt watching.
 * Chain + Privy are mocked; the live-fork pass is Phase 4 (Anvil).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxaeon/db";
import {
  TX_STATES,
  isTerminal,
  canTransition,
  assertTransition,
  isTxState,
} from "../src/core/txState.js";
import {
  getEip1559Fees,
  getEip1559FeeTiers,
  computeFeeTiers,
  selectFeeTier,
  medianBigint,
  clampBigint,
  MIN_PRIORITY_FEE_WEI,
  MAX_PRIORITY_FEE_WEI,
} from "../src/core/fees.js";
import {
  executeRoute,
  waitForReceipt,
  MAX_INITIAL_MAX_FEE_PER_GAS_WEI,
  MAX_INITIAL_TOTAL_FEE_WEI,
} from "../src/core/txExecutor.js";
import type { TradeTx } from "../src/fx/index.js";
import { BRIDGE_OFT_BY_TOKEN, EID_ETHEREUM } from "@aladdindao/fx-sdk";
import { ADDRESSES } from "@fxaeon/shared";
import { encodeFunctionData, erc20Abi, parseAbi } from "viem";

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
    // Nonce capture for speed-up/cancel — increments per call like a real RPC.
    getTransactionCount: vi.fn(async () => 5),
  };
}

const TEST_WALLET = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as const;
const SAVE_ABI = parseAbi(["function deposit(uint256,address)"]);
const TEST_DEPOSIT = 1_000_000_000_000_000_000n;
const TXS: TradeTx[] = [
  {
    to: ADDRESSES.FXUSD_BASE_POOL,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ADDRESSES.FXSAVE, TEST_DEPOSIT],
    }),
    value: 0n,
  },
  {
    to: ADDRESSES.FXSAVE,
    data: encodeFunctionData({
      abi: SAVE_ABI,
      functionName: "deposit",
      args: [TEST_DEPOSIT, TEST_WALLET],
    }),
    value: 0n,
  },
];

const OFT_SEND_ABI = [{
  type: "function", name: "send", stateMutability: "payable",
  inputs: [
    { name: "sendParam", type: "tuple", components: [
      { name: "dstEid", type: "uint32" }, { name: "to", type: "bytes32" },
      { name: "amountLD", type: "uint256" }, { name: "minAmountLD", type: "uint256" },
      { name: "extraOptions", type: "bytes" }, { name: "composeMsg", type: "bytes" },
      { name: "oftCmd", type: "bytes" },
    ] },
    { name: "fee", type: "tuple", components: [
      { name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" },
    ] },
    { name: "refundAddress", type: "address" },
  ], outputs: [],
}] as const;

function baseParams(client: unknown, key = "trade:1:abc") {
  return {
    userId: "user-1",
    walletId: "wal-1",
    walletAddress: TEST_WALLET,
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
    count: vi.fn().mockResolvedValue(0),
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
      "prepared", "simulated", "broadcasting", "broadcast", "confirmed", "reverted", "partial", "cancelled", "failed",
    ]);
    for (const s of ["confirmed", "reverted", "partial", "cancelled", "failed"] as const) expect(isTerminal(s)).toBe(true);
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

describe("Slow/Market/Fast fee tiers", () => {
  it("reads p10/p50/p90 priority tips and shares the base-fee buffer", async () => {
    // 3 blocks, each [p10, p50, p90] priority rewards.
    const client = {
      getFeeHistory: vi.fn(async () => ({
        baseFeePerGas: [10n * GWEI, 11n * GWEI, 12n * GWEI],
        gasUsedRatio: [],
        oldestBlock: 0n,
        reward: [
          [1n * GWEI, 2n * GWEI, 5n * GWEI],
          [1n * GWEI, 3n * GWEI, 7n * GWEI],
          [1n * GWEI, 2n * GWEI, 6n * GWEI],
        ],
      })),
    };
    const tiers = await getEip1559FeeTiers(client as never);
    expect(tiers.nextBaseFee).toBe(12n * GWEI);
    expect(tiers.slow.maxPriorityFeePerGas).toBe(1n * GWEI); // median(1,1,1)
    expect(tiers.market.maxPriorityFeePerGas).toBe(2n * GWEI); // median(2,3,2)
    expect(tiers.fast.maxPriorityFeePerGas).toBe(6n * GWEI); // median(5,7,6)
    // maxFee = 2*nextBaseFee + tip, same base buffer across tiers.
    expect(tiers.fast.maxFeePerGas).toBe(2n * 12n * GWEI + 6n * GWEI);
    expect(selectFeeTier(tiers, "fast")).toBe(tiers.fast);
  });

  it("computeFeeTiers clamps and keeps slow ≤ market ≤ fast", () => {
    const t = computeFeeTiers(10n * GWEI, { slow: 0n, market: 0n, fast: 500n * GWEI });
    expect(t.slow.maxPriorityFeePerGas).toBe(MIN_PRIORITY_FEE_WEI);
    expect(t.market.maxPriorityFeePerGas).toBe(MIN_PRIORITY_FEE_WEI);
    expect(t.fast.maxPriorityFeePerGas).toBe(MAX_PRIORITY_FEE_WEI);
    expect(t.slow.maxPriorityFeePerGas <= t.market.maxPriorityFeePerGas).toBe(true);
    expect(t.market.maxPriorityFeePerGas <= t.fast.maxPriorityFeePerGas).toBe(true);
  });

  it("refuses to guess when feeHistory has no usable base fee", async () => {
    const bad = { getFeeHistory: vi.fn(async () => ({ baseFeePerGas: [], reward: [] })) };
    await expect(getEip1559FeeTiers(bad as never)).rejects.toThrow(/refusing to guess/);
  });
});

describe("executeRoute", () => {
  const fee = feeClient([10n * GWEI, 12n * GWEI], [[2n * GWEI]]);

  it("rejects a withdrawal policy exception on any other action type", async () => {
    await expect(
      executeRoute({
        ...baseParams(fee),
        intentScopedWithdrawal: {
          recipient: "0x1111111111111111111111111111111111111111",
          tokenAddress: null,
          amount: 1n,
        },
      })
    ).rejects.toThrow(/only valid for withdrawals/);
  });

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

  it("executes a Base route with Base policy and Privy chain selection", async () => {
    const client = { ...fee, ...receiptClient(["success"]), chain: { id: 8453 } };
    const bridgeAmount = 10n * 10n ** 18n;
    const baseTx: TradeTx = {
      to: BRIDGE_OFT_BY_TOKEN.fxUSD[8453] as `0x${string}`,
      data: encodeFunctionData({
        abi: OFT_SEND_ABI,
        functionName: "send",
        args: [{
          dstEid: EID_ETHEREUM,
          to: `0x${baseParams(client).walletAddress.slice(2).padStart(64, "0")}`,
          amountLD: bridgeAmount,
          minAmountLD: bridgeAmount,
          extraOptions: "0x0003",
          composeMsg: "0x",
          oftCmd: "0x",
        }, { nativeFee: 1n, lzTokenFee: 0n }, baseParams(client).walletAddress],
      }),
      value: 1n,
    };
    const res = await executeRoute({
      ...baseParams(client, "bridge:base:1"),
      txs: [baseTx],
      type: "bridge_base_to_eth",
      chainId: 8453,
      intentScopedBridge: {
        sourceChainId: 8453,
        tokenAddress: baseTx.to,
        oftTarget: baseTx.to,
        amount: bridgeAmount,
      },
      mev: "off",
    });
    expect(res).toMatchObject({ ok: true, status: "confirmed" });
    expect(sendTxMock).toHaveBeenCalledTimes(1);
    const [, sent, chainId] = sendTxMock.mock.calls[0];
    expect(sent).toMatchObject({ chainId: 8453, type: 2, to: baseTx.to });
    expect(chainId).toBe(8453);
    expect((prisma.txRecord.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.data.chainId).toBe(8453);
    expect((prisma.txRecord.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.data.walletAddress).toBe(
      baseParams(client).walletAddress.toLowerCase()
    );
  });

  it("rejects Base Flashbots and client/source-chain mismatches before persistence", async () => {
    const baseClient = { ...fee, ...receiptClient(["success"]), chain: { id: 8453 } };
    await expect(
      executeRoute({ ...baseParams(baseClient), chainId: 8453, mev: "flashbots" })
    ).rejects.toThrow(/unavailable on Base/i);
    await expect(
      executeRoute({ ...baseParams(baseClient), chainId: 1 })
    ).rejects.toThrow(/does not match/i);
    expect(prisma.txRecord.create).not.toHaveBeenCalled();
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("derives the selected named tier from fresh feeHistory inside the executor", async () => {
    const client = {
      ...feeClient([10n * GWEI, 12n * GWEI], [[1n * GWEI, 2n * GWEI, 7n * GWEI]]),
      ...receiptClient(["success"]),
    };
    const res = await executeRoute({ ...baseParams(client), feeTier: "fast" });
    expect(res.ok).toBe(true);
    const firstTx = sendTxMock.mock.calls[0][1];
    expect(BigInt(firstTx.maxFeePerGas)).toBe(31n * GWEI);
    expect(BigInt(firstTx.maxPriorityFeePerGas)).toBe(7n * GWEI);
  });

  it("forces a fresh review when the live worst-case fee exceeds the reviewed tier budget", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    // 540k gas including executor headroom × 26 gwei.
    const reviewedMaximum = 540_000n * 26n * GWEI;
    const res = await executeRoute({
      ...baseParams(client, "trade:reviewed-fee:1"),
      maxTotalFeeWei: reviewedMaximum - 1n,
    });
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(res.ok ? "" : res.error).toMatch(/reviewed maximum.*fresh quote/i);
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("caps initial max fee and total network exposure independently of callers", async () => {
    const feeSpike = feeClient(
      [600n * GWEI],
      [[MAX_PRIORITY_FEE_WEI]]
    );
    const perGas = await executeRoute(baseParams(feeSpike, "trade:fee-spike:1"));
    expect(perGas).toMatchObject({ ok: false, status: "failed" });
    expect(perGas.ok ? "" : perGas.error).toMatch(/1000 gwei.*safety cap/i);
    expect(MAX_INITIAL_MAX_FEE_PER_GAS_WEI).toBe(1_000n * GWEI);

    vi.clearAllMocks();
    (prisma.txRecord as unknown as Record<string, ReturnType<typeof vi.fn>>) = {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: "rec-fee-total", ...data })),
      update: vi.fn().mockResolvedValue({}),
    };
    simulateRouteMock.mockResolvedValue({
      success: true,
      gasUsed: [10_000_000n, 10_000_000n],
      totalGas: 20_000_000n,
    });
    const total = await executeRoute(baseParams(fee, "trade:fee-total:1"));
    expect(total).toMatchObject({ ok: false, status: "failed" });
    expect(total.ok ? "" : total.error).toMatch(/0\.5 ETH.*safety cap/i);
    expect(MAX_INITIAL_TOTAL_FEE_WEI).toBe(500_000_000_000_000_000n);
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("is idempotent and never reports an existing pending broadcast as confirmed", async () => {
    (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rec-0",
      status: "broadcast",
      data: { hashes: ["0x" + "c".repeat(64)] },
    });
    const res = await executeRoute(baseParams(fee));
    expect(res).toMatchObject({ ok: false, deduped: true, status: "broadcast" });
    expect(res.ok ? "" : res.error).toMatch(/still pending.*0x[c]{64}/i);
    expect(sendTxMock).not.toHaveBeenCalled();
    expect(simulateRouteMock).not.toHaveBeenCalled();
  });

  it("turns a concurrent unique-key race into the same deduped result", async () => {
    const raced = {
      id: "rec-race",
      status: "prepared",
      data: { hashes: [] },
    };
    (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    (prisma.txRecord.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: "P2002" });

    const res = await executeRoute(baseParams(fee, "trade:race:1"));
    expect(res).toMatchObject({ ok: false, deduped: true, recordId: "rec-race", status: "prepared" });
    expect(res.ok ? "" : res.error).toMatch(/interrupted before broadcast/i);
    expect(simulateRouteMock).not.toHaveBeenCalled();
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent duplicates in-process and returns the winner's final result", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    let releaseSimulation!: () => void;
    const simulationGate = new Promise<void>((resolve) => { releaseSimulation = resolve; });
    simulateRouteMock.mockImplementationOnce(async () => {
      await simulationGate;
      return { success: true, gasUsed: [50_000n, 400_000n], totalGas: 450_000n };
    });

    const first = executeRoute(baseParams(client, "trade:concurrent:1"));
    await vi.waitFor(() => expect(simulateRouteMock).toHaveBeenCalledTimes(1));
    const duplicate = executeRoute(baseParams(client, "trade:concurrent:1"));
    releaseSimulation();

    const [winner, follower] = await Promise.all([first, duplicate]);
    expect(winner).toMatchObject({ ok: true, deduped: false, status: "confirmed" });
    expect(follower).toMatchObject({ ok: true, deduped: true, status: "confirmed" });
    expect(simulateRouteMock).toHaveBeenCalledTimes(1);
    expect(prisma.txRecord.create).toHaveBeenCalledTimes(1);
    expect(sendTxMock).toHaveBeenCalledTimes(2);
  });

  it("scopes equal idempotency keys to the authenticated user", async () => {
    const clientA = { ...fee, ...receiptClient(["success"]) };
    const clientB = { ...fee, ...receiptClient(["success"]) };
    (prisma.txRecord.create as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async ({ data }: { data: object }) => ({ id: "rec-a", ...data }))
      .mockImplementationOnce(async ({ data }: { data: object }) => ({ id: "rec-b", ...data }));
    sendTxMock.mockReset()
      .mockResolvedValueOnce({ hash: "0x" + "1".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "2".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "3".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "4".repeat(64) });

    const a = executeRoute(baseParams(clientA, "shared-client-nonce"));
    const b = executeRoute({
      ...baseParams(clientB, "shared-client-nonce"),
      userId: "user-2",
      walletId: "wal-2",
    });
    const [one, two] = await Promise.all([a, b]);
    expect(one).toMatchObject({ ok: true, deduped: false, recordId: "rec-a" });
    expect(two).toMatchObject({ ok: true, deduped: false, recordId: "rec-b" });
    expect(prisma.txRecord.create).toHaveBeenCalledTimes(2);
  });

  it("serializes different concurrent intents for the same wallet nonce lane", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    let releaseFirstSimulation!: () => void;
    const firstSimulationGate = new Promise<void>((resolve) => { releaseFirstSimulation = resolve; });
    simulateRouteMock
      .mockImplementationOnce(async () => {
        await firstSimulationGate;
        return { success: true, gasUsed: [50_000n, 400_000n], totalGas: 450_000n };
      })
      .mockResolvedValueOnce({ success: true, gasUsed: [50_000n, 400_000n], totalGas: 450_000n });
    sendTxMock
      .mockReset()
      .mockResolvedValueOnce({ hash: "0x" + "1".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "2".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "3".repeat(64) })
      .mockResolvedValueOnce({ hash: "0x" + "4".repeat(64) });

    const first = executeRoute(baseParams(client, "trade:nonce-lane:1"));
    await vi.waitFor(() => expect(simulateRouteMock).toHaveBeenCalledTimes(1));
    const second = executeRoute(baseParams(client, "trade:nonce-lane:2"));

    // The second intent must not even simulate while the first owns the EOA's
    // nonce lane; its route and cap are re-checked only when it can broadcast.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(simulateRouteMock).toHaveBeenCalledTimes(1);
    releaseFirstSimulation();

    const [one, two] = await Promise.all([first, second]);
    expect(one).toMatchObject({ ok: true, status: "confirmed" });
    expect(two).toMatchObject({ ok: true, status: "confirmed" });
    expect(simulateRouteMock).toHaveBeenCalledTimes(2);
    expect(sendTxMock).toHaveBeenCalledTimes(4);
  });

  it("enforces the persisted daily transaction cap before broadcast", async () => {
    (prisma.txRecord.count as ReturnType<typeof vi.fn>).mockResolvedValue(50);
    const res = await executeRoute(baseParams(fee, "trade:capped:1"));
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(res.ok ? "" : res.error).toMatch(/daily transaction limit/i);
    expect(simulateRouteMock).toHaveBeenCalledTimes(1);
    expect(sendTxMock).not.toHaveBeenCalled();
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

  it.each(["prepared", "simulated", "broadcasting"] as const)(
    "never reports a stale %s record without a hash as successful",
    async (status) => {
      (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "rec-stale",
        status,
        data: { hashes: [] },
      });
      const res = await executeRoute(baseParams(fee, `trade:stale:${status}`));
      expect(res).toMatchObject({ ok: false, deduped: true, status });
      expect(sendTxMock).not.toHaveBeenCalled();
    }
  );

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

  it("persists an honest partial state when a later route step never broadcasts", async () => {
    const client = { ...fee, ...receiptClient(["success"]) };
    sendTxMock.mockReset()
      .mockResolvedValueOnce({ hash: "0x" + "a".repeat(64) })
      .mockRejectedValueOnce(new Error("signer unavailable"));
    const res = await executeRoute(baseParams(client, "trade:partial:1"));
    expect(res).toMatchObject({ ok: false, status: "partial" });
    expect(res.ok ? "" : res.error).toMatch(/earlier txs landed/i);
    const updates = (prisma.txRecord.update as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0]);
    expect(updates.some((call) => call.data?.status === "partial")).toBe(true);
    expect(updates.some((call) =>
      call.data?.data?.steps?.[0]?.status === "confirmed" && call.data?.data?.pending === undefined
    )).toBe(true);
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

  it("observes the durable outcome of a same-nonce replacement hash", async () => {
    const client = receiptClient(["pending"]);
    (prisma.txRecord.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "rec-replaced",
      data: { steps: [{ status: "confirmed", hash: "0x" + "d".repeat(64) }] },
    });
    await expect(waitForReceipt(client as never, "0xabc" as never, {
      pollMs: 1,
      timeoutMs: 100,
      recordId: "rec-replaced",
      routeIndex: 0,
    })).resolves.toBe("confirmed");
  });
});
