import { describe, it, expect, vi } from "vitest";

/**
 * Fee attribution tests — Phase 5.
 * Tests that every FeeLedger insert includes referral attribution.
 */

vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    feeLedger: {
      create: vi.fn().mockResolvedValue({}),
    },
    botState: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FEE_COLLECTOR: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
  },
}));

import {
  getFeeBps,
  calculateFeeAmount,
  calculateFeeUsd,
  isLeverageAction,
  LEVERAGE_FEE_BPS,
  OTHER_FEE_BPS,
  resolveReferrerCode,
  applyFxAeonFee,
} from "../src/core/fxaeonFees.js";
import { prisma } from "@fxaeon/db";

describe("Fee calculation", () => {
  it("leverage actions get LEVERAGE_FEE_BPS (5 bps)", () => {
    expect(getFeeBps("open_long")).toBe(LEVERAGE_FEE_BPS);
    expect(getFeeBps("close_short")).toBe(LEVERAGE_FEE_BPS);
    expect(getFeeBps("adjust_leverage")).toBe(LEVERAGE_FEE_BPS);
  });

  it("non-leverage actions get OTHER_FEE_BPS (1 bp)", () => {
    expect(getFeeBps("fxsave_deposit")).toBe(OTHER_FEE_BPS);
    expect(getFeeBps("mint")).toBe(OTHER_FEE_BPS);
    expect(getFeeBps("bridge")).toBe(OTHER_FEE_BPS);
  });

  it("calculates fee amount in wei", () => {
    const notional = 1_000_000n; // 1M wei
    const fee = calculateFeeAmount(notional, 5);
    expect(fee).toBe(500n); // 0.05%
  });

  it("calculates fee in USD", () => {
    const feeUsd = calculateFeeUsd(10_000, 5);
    expect(feeUsd).toBeCloseTo(5, 2); // 0.05% of $10,000
  });
});

describe("resolveReferrerCode", () => {
  it("returns referredBy when user has one", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      referredBy: "REF123",
    } as any);

    const code = await resolveReferrerCode("user-1");
    expect(code).toBe("REF123");
  });

  it("returns undefined when user has no referrer", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      referredBy: null,
    } as any);

    const code = await resolveReferrerCode("user-2");
    expect(code).toBeUndefined();
  });

  it("returns undefined on error", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error("DB down"));

    const code = await resolveReferrerCode("user-3");
    expect(code).toBeUndefined();
  });
});

describe("applyFxAeonFee referral attribution", () => {
  it("auto-resolves referrerCode when not provided", async () => {
    // Setup: user has referredBy = "AUTO_REF"
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      referredBy: "AUTO_REF",
    } as any);

    const result = await applyFxAeonFee({
      userId: "user-1",
      intentKind: "open_long",
      notionalUsd: 1000,
      notionalWei: 1_000_000_000_000_000_000n,
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      // referrerCode NOT provided — should be auto-resolved
    });

    expect(result.applied).toBe(true);
    expect(result.mode).toBe("observe");

    // Verify feeLedger.create was called with the resolved referrerCode
    const createCall = vi.mocked(prisma.feeLedger.create).mock.calls;
    const lastCall = createCall[createCall.length - 1];
    expect(lastCall[0].data.referrerCode).toBe("AUTO_REF");
  });
});
