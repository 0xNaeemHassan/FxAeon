import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fee reconciler poller tests — Phase 3.
 * Tests orphan retry logic, max retries, and stats.
 */

const mockFindMany = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn();
const mockCount = vi.fn().mockResolvedValue(0);
const mockAggregate = vi.fn().mockResolvedValue({ _sum: { usdAmount: 0 } });
const mockBotStateFind = vi.fn().mockResolvedValue({ value: "enforce" });

vi.mock("@fxaeon/db", () => ({
  prisma: {
    feeLedger: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update: (...args: any[]) => mockUpdate(...args),
      count: (...args: any[]) => mockCount(...args),
      aggregate: (...args: any[]) => mockAggregate(...args),
      create: vi.fn(),
    },
    botState: {
      findUnique: (...args: any[]) => mockBotStateFind(...args),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FEE_COLLECTOR: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
  },
}));

import { reconcileFees, getReconcilerStats } from "../src/notifications/fee-reconciler-poller.js";

describe("reconcileFees", () => {
  const mockTransfer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBotStateFind.mockResolvedValue({ value: "enforce" });
  });

  it("returns zero counts when no orphans exist", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const result = await reconcileFees(mockTransfer);
    expect(result).toEqual({ retried: 0, confirmed: 0, failed: 0 });
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it("retries orphaned fee and marks confirmed on success", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "fee-1",
        userId: "user-1",
        intentKind: "open_long",
        tokenAddress: "0x085780639cc2cacd35e474e71f4d000e2405d8f6",
        tokenAmountWei: "500000000000000",
        retryCount: 0,
      },
    ]);
    mockTransfer.mockResolvedValueOnce({ hash: "0xabc123" });

    const result = await reconcileFees(mockTransfer);
    expect(result.retried).toBe(1);
    expect(result.confirmed).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fee-1" },
        data: expect.objectContaining({ feeOrphan: false, txHash: "0xabc123" }),
      })
    );
  });

  it("increments retry on transfer failure", async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "fee-2",
        userId: "user-1",
        intentKind: "close_long",
        tokenAddress: "0x085780639cc2cacd35e474e71f4d000e2405d8f6",
        tokenAmountWei: "100000000000000",
        retryCount: 1,
      },
    ]);
    mockTransfer.mockRejectedValueOnce(new Error("RPC timeout"));

    const result = await reconcileFees(mockTransfer);
    expect(result.retried).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("skips reconciliation when fee mode is observe", async () => {
    mockBotStateFind.mockResolvedValueOnce({ value: "observe" });
    const result = await reconcileFees(mockTransfer);
    expect(result).toEqual({ retried: 0, confirmed: 0, failed: 0 });
  });

  it("skips reconciliation when fee mode is off", async () => {
    mockBotStateFind.mockResolvedValueOnce({ value: "off" });
    const result = await reconcileFees(mockTransfer);
    expect(result).toEqual({ retried: 0, confirmed: 0, failed: 0 });
  });
});

describe("getReconcilerStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero stats when empty", async () => {
    mockCount.mockResolvedValue(0);
    mockAggregate.mockResolvedValue({ _sum: { usdAmount: 0 } });
    const stats = await getReconcilerStats();
    expect(stats.orphanCount).toBe(0);
    expect(stats.totalFeeUsd).toBe(0);
  });
});
