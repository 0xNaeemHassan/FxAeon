import { describe, it, expect, vi } from "vitest";

/**
 * Referral payout tests — Phase 5.
 * Tests tier calculation, payout cycle labeling, and self-referral guard.
 */

// Mock prisma (not used directly in pure functions)
vi.mock("@fxaeon/db", () => ({
  prisma: {
    feeLedger: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  previousPayoutCycle,
  getReferrerTier,
  runReferralPayout,
} from "../src/notifications/referral-payout.js";
import { prisma } from "@fxaeon/db";

describe("previousPayoutCycle", () => {
  it("returns previous month", () => {
    const july = new Date("2026-07-15T12:00:00Z");
    expect(previousPayoutCycle(july)).toBe("2026-06");
  });

  it("wraps around to December for January", () => {
    const jan = new Date("2026-01-01T00:00:00Z");
    expect(previousPayoutCycle(jan)).toBe("2025-12");
  });

  it("pads single-digit months", () => {
    const march = new Date("2026-03-15T12:00:00Z");
    expect(previousPayoutCycle(march)).toBe("2026-02");
  });
});

describe("getReferrerTier", () => {
  it("returns Tier 1 (30%) for volume under $25k", () => {
    const { tier, sharePct } = getReferrerTier(10_000);
    expect(tier).toBe(1);
    expect(sharePct).toBe(30);
  });

  it("returns Tier 2 (50%) for volume at exactly $25k", () => {
    const { tier, sharePct } = getReferrerTier(25_000);
    expect(tier).toBe(2);
    expect(sharePct).toBe(50);
  });

  it("returns Tier 2 (50%) for volume above $25k", () => {
    const { tier, sharePct } = getReferrerTier(100_000);
    expect(tier).toBe(2);
    expect(sharePct).toBe(50);
  });

  it("returns Tier 1 for zero volume", () => {
    const { tier } = getReferrerTier(0);
    expect(tier).toBe(1);
  });
});

describe("Self-referral guard", () => {
  it("skips rows where user is their own referrer", async () => {
    // Simulate: fee rows with referrerCode "ABC123", but the referrer user
    // IS the same user who made the trade (self-referral)
    const selfUserId = "user-self";
    vi.mocked(prisma.feeLedger.findMany).mockResolvedValueOnce([
      {
        id: "fee-1",
        referrerCode: "ABC123",
        usdAmount: 10,
        notionalUsd: 1000,
        userId: selfUserId,
      } as any,
    ]);

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: selfUserId, // Same user — self-referral!
      telegramId: "123",
    } as any);

    const result = await runReferralPayout({
      cycle: "2026-06",
      dryRun: true,
    });

    // Self-referral should be excluded
    expect(result.referrers.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("self-referrals");
  });

  it("processes valid referrals correctly", async () => {
    const referrerId = "user-referrer";
    const traderId = "user-trader";

    vi.mocked(prisma.feeLedger.findMany).mockResolvedValueOnce([
      {
        id: "fee-2",
        referrerCode: "REF456",
        usdAmount: 5,
        notionalUsd: 5000,
        userId: traderId,
      } as any,
    ]);

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: referrerId, // Different user — valid referral
      telegramId: "456",
    } as any);

    const result = await runReferralPayout({
      cycle: "2026-06",
      dryRun: true,
    });

    expect(result.referrers.length).toBe(1);
    expect(result.referrers[0].referrerCode).toBe("REF456");
    expect(result.referrers[0].payoutUsd).toBe(5 * 0.3); // 30% of $5 fee
    expect(result.referrers[0].tier).toBe(1); // Volume $5k < $25k threshold
  });
});

describe("Payout cap", () => {
  it("caps payout at $10,000 per referrer per cycle", async () => {
    const referrerId = "user-whale-referrer";
    const traderId = "user-whale-trader";

    // Large volume that would produce >$10k payout
    vi.mocked(prisma.feeLedger.findMany).mockResolvedValueOnce([
      {
        id: "fee-3",
        referrerCode: "WHALE",
        usdAmount: 50_000, // $50k in fees
        notionalUsd: 10_000_000,
        userId: traderId,
      } as any,
    ]);

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: referrerId,
      telegramId: "789",
    } as any);

    const result = await runReferralPayout({
      cycle: "2026-06",
      dryRun: true,
    });

    expect(result.referrers.length).toBe(1);
    // 50% of $50k = $25k, but capped at $10k
    expect(result.referrers[0].payoutUsd).toBe(10_000);
  });
});
