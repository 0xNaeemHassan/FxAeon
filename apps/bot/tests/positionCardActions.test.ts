import { describe, it, expect, vi } from "vitest";

/**
 * Position card actions tests — Phase 2.
 * Tests keyboard generation, card rendering, and health status.
 */

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    STETH: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  },
  MARKETS: ["wstETH", "WBTC"],
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("../src/core/callbackKeys.js", () => ({
  storeCallbackPayload: vi.fn(() => "abcdef0123"),
  consumeCallbackPayload: vi.fn(),
}));

vi.mock("../src/fx/index.js", () => ({
  createFxSdk: vi.fn(),
}));

vi.mock("../src/core/portfolio.js", () => ({
  fetchOnChainPositions: vi.fn(),
  findUserPosition: vi.fn(),
}));

import { renderPositionCard } from "../src/handlers/positionCardActions.js";
import type { OnChainPosition } from "../src/core/portfolio.js";

describe("renderPositionCard", () => {
  const mockPosition: OnChainPosition = {
    market: "wstETH",
    side: "long",
    positionId: 42,
    collateral: 2.5,
    rawCollateral: 2_500_000_000_000_000_000n,
    collateralToken: "wstETH",
    debt: 5000,
    debtToken: "fxUSD",
    leverage: 3.5,
    debtRatio: 0.714,
    health: 0.65,
  };

  it("renders position details correctly", () => {
    const { text } = renderPositionCard(mockPosition);
    expect(text).toContain("wstETH LONG #42");
    expect(text).toContain("2.500000");
    expect(text).toContain("5000.00");
    expect(text).toContain("3.50×");
    expect(text).toContain("71.4%");
  });

  it("shows green health emoji for safe positions", () => {
    const { text } = renderPositionCard({ ...mockPosition, health: 0.5 });
    expect(text).toContain("🟢");
  });

  it("shows yellow health emoji for warning range", () => {
    const { text } = renderPositionCard({ ...mockPosition, health: 0.75 });
    expect(text).toContain("🟡");
  });

  it("shows orange health emoji for urgent range", () => {
    const { text } = renderPositionCard({ ...mockPosition, health: 0.9 });
    expect(text).toContain("🟠");
  });

  it("shows red health emoji at liquidation threshold", () => {
    const { text } = renderPositionCard({ ...mockPosition, health: 0.96 });
    expect(text).toContain("🔴");
  });

  it("includes long emoji for long positions", () => {
    const { text } = renderPositionCard({ ...mockPosition, side: "long" });
    expect(text).toContain("📈");
  });

  it("includes short emoji for short positions", () => {
    const { text } = renderPositionCard({ ...mockPosition, side: "short" });
    expect(text).toContain("📉");
  });

  it("includes mini app URL when provided", () => {
    const { keyboard } = renderPositionCard(mockPosition, "https://app.fxaeon.com");
    // Keyboard should include the URL button
    expect(keyboard).toBeDefined();
  });
});

describe("PnL history formatting", () => {
  // Import the pure formatting functions
  it("formats duration correctly", async () => {
    const { formatDuration } = await import("../src/core/pnlHistory.js");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(300_000)).toBe("5m");
    expect(formatDuration(7_200_000)).toBe("2h 0m");
    expect(formatDuration(90_000_000)).toBe("1d 1h");
  });

  it("formats closed position with profit", async () => {
    const { formatClosedPosition } = await import("../src/core/pnlHistory.js");
    const result = formatClosedPosition({
      market: "wstETH",
      side: "long",
      positionId: 10,
      entryCollateral: 1.0,
      entryDebt: 2000,
      entrySpotUsd: 3400,
      entryAt: new Date("2026-06-01"),
      closedAt: new Date("2026-06-15"),
      realizedPnlUsd: 420,
      realizedPnlPct: 30,
      durationMs: 14 * 24 * 60 * 60 * 1000,
    });
    expect(result).toContain("🟢");
    expect(result).toContain("wstETH LONG #10");
    expect(result).toContain("+30.0%");
    expect(result).toContain("+$420.00");
    expect(result).toContain("14d");
  });

  it("formats closed position with loss", async () => {
    const { formatClosedPosition } = await import("../src/core/pnlHistory.js");
    const result = formatClosedPosition({
      market: "WBTC",
      side: "short",
      positionId: 5,
      entryCollateral: 0.5,
      entryDebt: 30000,
      entrySpotUsd: 103000,
      entryAt: new Date("2026-06-01"),
      closedAt: new Date("2026-06-03"),
      realizedPnlUsd: -250,
      realizedPnlPct: -5.2,
      durationMs: 2 * 24 * 60 * 60 * 1000,
    });
    expect(result).toContain("🔴");
    expect(result).toContain("WBTC SHORT #5");
    expect(result).toContain("−5.2%");
    expect(result).toContain("−$250.00");
  });

  it("handles unknown PnL gracefully", async () => {
    const { formatClosedPosition } = await import("../src/core/pnlHistory.js");
    const result = formatClosedPosition({
      market: "wstETH",
      side: "long",
      positionId: 7,
      entryCollateral: 1.0,
      entryDebt: 2000,
      entrySpotUsd: null,
      entryAt: new Date("2026-06-01"),
      closedAt: new Date("2026-06-02"),
      realizedPnlUsd: null,
      realizedPnlPct: null,
      durationMs: 24 * 60 * 60 * 1000,
    });
    expect(result).toContain("⚪");
    expect(result).toContain("PnL: n/a");
  });
});
