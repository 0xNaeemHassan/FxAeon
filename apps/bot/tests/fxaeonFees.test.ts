import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FxAeon fee module tests — Phase 3.
 * Tests fee calculation, mode handling, preview generation, and ledger recording.
 */

vi.mock("@fxaeon/db", () => ({
  prisma: {
    feeLedger: {
      create: vi.fn().mockResolvedValue({ id: "test-fee-id" }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { usdAmount: 0 } }),
    },
    botState: {
      findUnique: vi.fn().mockResolvedValue(null),
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
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  },
}));

import {
  LEVERAGE_FEE_BPS,
  OTHER_FEE_BPS,
  FEE_COLLECTOR,
  isLeverageAction,
  getFeeBps,
  calculateFeeAmount,
  calculateFeeUsd,
  buildFeePreview,
  type IntentKind,
} from "../src/core/fxaeonFees.js";

describe("Fee constants", () => {
  it("LEVERAGE_FEE_BPS is 5 (0.05%)", () => {
    expect(LEVERAGE_FEE_BPS).toBe(5);
  });

  it("OTHER_FEE_BPS is 1 (0.01%)", () => {
    expect(OTHER_FEE_BPS).toBe(1);
  });

  it("FEE_COLLECTOR matches masterplan address", () => {
    expect(FEE_COLLECTOR.toLowerCase()).toBe("0xea24f6a870b57455a83387704d7d2a12e3463d84");
  });
});

describe("isLeverageAction", () => {
  it.each<[IntentKind, boolean]>([
    ["open_long", true],
    ["open_short", true],
    ["close_long", true],
    ["close_short", true],
    ["adjust_leverage", true],
    ["increase_position", true],
    ["reduce_position", true],
    ["fxsave_deposit", false],
    ["fxsave_withdraw", false],
    ["mint", false],
    ["redeem", false],
    ["bridge", false],
  ])("isLeverageAction('%s') = %s", (kind, expected) => {
    expect(isLeverageAction(kind)).toBe(expected);
  });
});

describe("getFeeBps", () => {
  it("returns 5 for leverage actions", () => {
    expect(getFeeBps("open_long")).toBe(5);
    expect(getFeeBps("close_short")).toBe(5);
  });

  it("returns 1 for other actions", () => {
    expect(getFeeBps("fxsave_deposit")).toBe(1);
    expect(getFeeBps("mint")).toBe(1);
  });
});

describe("calculateFeeAmount", () => {
  it("calculates 0.05% of 1 ETH (1e18 wei)", () => {
    const notional = 1_000_000_000_000_000_000n; // 1 ETH
    const fee = calculateFeeAmount(notional, 5);
    expect(fee).toBe(500_000_000_000_000n); // 0.0005 ETH
  });

  it("calculates 0.01% of 1 ETH (1e18 wei)", () => {
    const notional = 1_000_000_000_000_000_000n;
    const fee = calculateFeeAmount(notional, 1);
    expect(fee).toBe(100_000_000_000_000n); // 0.0001 ETH
  });

  it("returns 0 for zero notional", () => {
    expect(calculateFeeAmount(0n, 5)).toBe(0n);
  });

  it("calculates correctly for large amounts", () => {
    const notional = 100_000_000_000_000_000_000n; // 100 ETH
    const fee = calculateFeeAmount(notional, 5);
    expect(fee).toBe(50_000_000_000_000_000n); // 0.05 ETH
  });

  it("handles WBTC (8 decimals) correctly", () => {
    const notional = 100_000_000n; // 1 WBTC (8 decimals)
    const fee = calculateFeeAmount(notional, 5);
    expect(fee).toBe(50_000n); // 0.0005 WBTC
  });
});

describe("calculateFeeUsd", () => {
  it("calculates 0.05% of $10,000", () => {
    expect(calculateFeeUsd(10_000, 5)).toBeCloseTo(5.0);
  });

  it("calculates 0.01% of $10,000", () => {
    expect(calculateFeeUsd(10_000, 1)).toBeCloseTo(1.0);
  });

  it("calculates 0.05% of $500", () => {
    expect(calculateFeeUsd(500, 5)).toBeCloseTo(0.25);
  });
});

describe("buildFeePreview", () => {
  it("generates preview for leverage action", () => {
    const preview = buildFeePreview("open_long", 10_000, 5);
    expect(preview.fxAeonFeePct).toBe("0.05");
    expect(preview.fxAeonFeeUsd).toBeCloseTo(5.0);
    expect(preview.lines.length).toBe(3);
    expect(preview.lines[0]).toContain("f(x) protocol fee");
    expect(preview.lines[1]).toContain("FxAeon fee");
    expect(preview.lines[1]).toContain("0.05%");
    expect(preview.lines[1]).toContain("$5.00");
    expect(preview.lines[2]).toContain("Total est. fees");
  });

  it("generates preview for other action", () => {
    const preview = buildFeePreview("fxsave_deposit", 5_000);
    expect(preview.fxAeonFeePct).toBe("0.01");
    expect(preview.fxAeonFeeUsd).toBeCloseTo(0.5);
  });

  it("includes all three fee lines", () => {
    const preview = buildFeePreview("open_short", 20_000, 3);
    expect(preview.lines[0]).toMatch(/f\(x\) protocol fee/);
    expect(preview.lines[1]).toMatch(/FxAeon fee/);
    expect(preview.lines[2]).toMatch(/Total est\. fees/);
  });

  it("protocol fee scales with leverage", () => {
    const preview3x = buildFeePreview("open_long", 10_000, 3);
    const preview7x = buildFeePreview("open_long", 10_000, 7);
    // Higher leverage → higher protocol fee
    expect(parseFloat(preview7x.fxProtocolFeePct)).toBeGreaterThan(
      parseFloat(preview3x.fxProtocolFeePct)
    );
  });
});

describe("Signer policy fee collector exception", () => {
  it("FEE_COLLECTOR is in the address registry", async () => {
    const { ADDRESSES } = await import("@fxaeon/shared");
    expect(ADDRESSES.FEE_COLLECTOR).toBe("0xea24f6a870b57455a83387704d7d2a12e3463d84");
  });
});
