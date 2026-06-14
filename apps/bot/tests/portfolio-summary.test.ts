/**
 * Unit tests for the Mini App portfolio valuation summary (Screen 4 hero).
 * Focus: honesty — totals are null whenever any required price is missing,
 * never a partial sum dressed up as complete.
 */
import { describe, it, expect } from "vitest";
import { summarizePortfolio, valuePosition } from "../src/core/portfolioSummary";
import type { OnChainPosition } from "../src/core/portfolio";
import type { FundingState } from "../src/core/funding";

function pos(over: Partial<OnChainPosition> = {}): OnChainPosition {
  return {
    market: "ETH",
    side: "long",
    positionId: 1,
    collateral: 2,
    collateralToken: "wstETH",
    debt: 1000,
    debtToken: "fxUSD",
    leverage: 3,
    debtRatio: 0.66,
    health: 0.2,
    ...(over as OnChainPosition),
  } as OnChainPosition;
}

const funded: FundingState = { known: true, funded: true, eth: "1", wstEth: "0", wbtc: "0" };
const prices = { ETH: 3000, wstETH: 3500, WBTC: 60000, FXUSD: 1 };

describe("valuePosition", () => {
  it("nets collateral minus debt at live spot", () => {
    const v = valuePosition(pos(), prices);
    expect(v).not.toBeNull();
    expect(v!.collateralUsd).toBe(7000); // 2 * 3500
    expect(v!.debtUsd).toBe(1000); // 1000 * 1 (fxUSD)
    expect(v!.netUsd).toBe(6000);
  });

  it("returns null when the collateral token is unpriced", () => {
    expect(valuePosition(pos({ collateralToken: "MYSTERY" }), prices)).toBeNull();
  });

  it("falls back to $1 for fxUSD debt when FXUSD price is absent", () => {
    const v = valuePosition(pos(), { wstETH: 3500 });
    expect(v!.debtUsd).toBe(1000);
  });
});

describe("summarizePortfolio", () => {
  it("sums wallet cash + position equity into a real total", () => {
    const s = summarizePortfolio(funded, [pos()], [{ pnlUsd: 250 }], prices);
    expect(s.walletUsd).toBe(3000); // 1 ETH
    expect(s.positionsUsd).toBe(6000);
    expect(s.totalValueUsd).toBe(9000);
    expect(s.netPnlUsd).toBe(250);
    // basis = 6000 - 250 = 5750 → 250/5750 ≈ 4.3478%
    expect(s.netPnlPct).toBeCloseTo(4.3478, 3);
  });

  it("total is null when a held wallet token is unpriced", () => {
    const s = summarizePortfolio(
      { known: true, funded: true, eth: "0", wstEth: "0", wbtc: "0.5" },
      [],
      [],
      { ETH: 3000, wstETH: 3500 } // no WBTC price
    );
    expect(s.walletUsd).toBeNull();
    expect(s.totalValueUsd).toBeNull();
  });

  it("total is null when any position is unpriced", () => {
    const s = summarizePortfolio(funded, [pos(), pos({ collateralToken: "MYSTERY" })], [{ pnlUsd: 1 }, null], prices);
    expect(s.positionsUsd).toBeNull();
    expect(s.totalValueUsd).toBeNull();
  });

  it("netPnl is null unless every open position has a PnL estimate", () => {
    const s = summarizePortfolio(funded, [pos(), pos({ positionId: 2 })], [{ pnlUsd: 10 }, null], prices);
    expect(s.netPnlUsd).toBeNull();
  });

  it("a cash-only wallet shows cash as total and no PnL", () => {
    const s = summarizePortfolio(funded, [], [], prices);
    expect(s.totalValueUsd).toBe(3000);
    expect(s.netPnlUsd).toBeNull();
    expect(s.netPnlPct).toBeNull();
  });

  it("returns all-null when prices are unavailable", () => {
    const s = summarizePortfolio(funded, [pos()], [{ pnlUsd: 1 }], null);
    expect(s.totalValueUsd).toBeNull();
    expect(s.walletUsd).toBeNull();
  });
});
