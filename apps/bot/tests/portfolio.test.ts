import { describe, it, expect, vi } from "vitest";

/**
 * Portfolio command tests — Phase 4.
 * Tests the single-screen redesign utility functions.
 */

vi.mock("@fxaeon/shared", () => ({
  HEALTH_LEVELS: { URGENT: 0.9, WARNING: 0.7 },
  MARKETS: ["wstETH", "WBTC"],
}));

import { getRiskBar, positionUsd } from "../src/commands/portfolio.js";

describe("getRiskBar", () => {
  it("shows green for healthy positions", () => {
    const bar = getRiskBar(0.3);
    expect(bar).toContain("🟢");
    expect(bar).toContain("30%");
  });

  it("shows yellow for warning positions", () => {
    const bar = getRiskBar(0.75);
    expect(bar).toContain("🟡");
    expect(bar).toContain("75%");
  });

  it("shows red for critical positions", () => {
    const bar = getRiskBar(0.95);
    expect(bar).toContain("🔴");
    expect(bar).toContain("95%");
  });

  it("clamps at 0", () => {
    const bar = getRiskBar(-0.1);
    expect(bar).toContain("🟢");
  });

  it("clamps at 1", () => {
    const bar = getRiskBar(1.5);
    expect(bar).toContain("🔴");
  });
});

describe("positionUsd", () => {
  const mockPosition = {
    market: "wstETH",
    side: "long" as const,
    positionId: 1,
    collateral: 2.5,
    collateralToken: "wstETH",
    debt: 5000,
    debtToken: "fxUSD",
    debtRatio: 0.5,
    leverage: 3,
    health: 0.3,
    liquidationPrice: 1200,
  };

  it("computes USD values from prices", () => {
    const prices = { wstETH: 3400, FXUSD: 1 };
    const usd = positionUsd(mockPosition, prices);
    expect(usd).not.toBeNull();
    expect(usd!.collateralUsd).toBeCloseTo(8500); // 2.5 * 3400
    expect(usd!.debtUsd).toBeCloseTo(5000);        // 5000 * 1
    expect(usd!.netUsd).toBeCloseTo(3500);          // 8500 - 5000
  });

  it("returns null when collateral price unavailable", () => {
    const prices = { FXUSD: 1 };
    const usd = positionUsd(mockPosition, prices);
    expect(usd).toBeNull();
  });

  it("defaults fxUSD to $1 when price unavailable", () => {
    const prices = { wstETH: 3400 };
    const usd = positionUsd(mockPosition, prices);
    expect(usd).not.toBeNull();
    expect(usd!.debtUsd).toBeCloseTo(5000);
  });
});
