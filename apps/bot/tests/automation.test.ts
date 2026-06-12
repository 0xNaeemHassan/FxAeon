/**
 * /auto — stop-loss / take-profit parsing, trigger direction semantics, the
 * pure poller predicate, and PnL math (entry snapshots).
 */
import { describe, it, expect } from "vitest";
import {
  parseRuleArgs,
  describeRule,
  triggerDirection,
  MAX_ACTIVE_RULES,
  type ParsedRule,
} from "../src/commands/auto.js";
import {
  ruleShouldFire,
  formatTriggerMessage,
  MAX_FAILURES,
  type RuleRecord,
} from "../src/notifications/automation-poller.js";
import { computePnl, snapshotKey, type SnapshotRecord } from "../src/core/pnl.js";
import type { OnChainPosition } from "../src/core/portfolio.js";

function rule(trigger: Record<string, unknown>, over: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: "r1",
    userId: "u1",
    name: "test rule",
    type: "stop_loss",
    triggerPrice: trigger,
    failureCount: 0,
    deadline: new Date(Date.now() + 86_400_000),
    ...over,
  };
}

function pos(over: Partial<OnChainPosition> = {}): OnChainPosition {
  return {
    market: "wstETH",
    side: "long",
    positionId: 7,
    collateral: 2,
    rawCollateral: 2_000_000_000_000_000_000n,
    collateralToken: "wstETH",
    debt: 3000,
    debtToken: "fxUSD",
    leverage: 2,
    debtRatio: 0.5,
    health: 0.5,
    ...over,
  } as OnChainPosition;
}

describe("triggerDirection", () => {
  it("long: SL watches below, TP watches above", () => {
    expect(triggerDirection("stop_loss", "long")).toBe("below");
    expect(triggerDirection("take_profit", "long")).toBe("above");
  });

  it("short: inverted — SL above, TP below", () => {
    expect(triggerDirection("stop_loss", "short")).toBe("above");
    expect(triggerDirection("take_profit", "short")).toBe("below");
  });
});

describe("parseRuleArgs", () => {
  it("parses sl/tp with market, side and price (case-insensitive, $ and commas ok)", () => {
    expect(parseRuleArgs(["sl", "wsteth", "long", "2500"])).toEqual({
      kind: "stop_loss",
      market: "wstETH",
      side: "long",
      priceUsd: 2500,
    });
    expect(parseRuleArgs(["TP", "WBTC", "SHORT", "$60,000"])).toEqual({
      kind: "take_profit",
      market: "WBTC",
      side: "short",
      priceUsd: 60000,
    });
  });

  it("rejects unknown markets, bad sides, and non-positive prices with human messages", () => {
    expect(parseRuleArgs(["sl", "doge", "long", "1"])).toMatch(/Unknown market/);
    expect(parseRuleArgs(["sl", "wstETH", "sideways", "1"])).toMatch(/long.*short/);
    expect(parseRuleArgs(["sl", "wstETH", "long", "-5"])).toMatch(/positive number/);
    expect(parseRuleArgs(["sl", "wstETH", "long", "abc"])).toMatch(/positive number/);
  });

  it("is honest about unimplemented automation kinds", () => {
    expect(parseRuleArgs(["compound", "wstETH", "long", "1"])).toMatch(/isn't available yet/);
    expect(parseRuleArgs(["dca"])).toMatch(/isn't available yet/);
  });

  it("returns usage for empty/garbage input", () => {
    expect(parseRuleArgs([])).toMatch(/Usage/);
    expect(parseRuleArgs(["frobnicate", "x", "y", "1"])).toMatch(/Usage/);
  });

  it("describes rules with the right comparator", () => {
    const sl = parseRuleArgs(["sl", "wstETH", "long", "2500"]) as ParsedRule;
    const tp = parseRuleArgs(["tp", "wstETH", "short", "2000"]) as ParsedRule;
    expect(describeRule(sl)).toContain("≤");
    expect(describeRule(tp)).toContain("≤"); // short TP fires as price falls
    expect(describeRule(sl)).toMatch(/Stop-loss/);
  });

  it("caps documented at 10 active rules", () => {
    expect(MAX_ACTIVE_RULES).toBe(10);
  });
});

describe("ruleShouldFire", () => {
  const below = { market: "wstETH", side: "long", priceUsd: 2500, direction: "below" };
  const above = { market: "wstETH", side: "long", priceUsd: 3500, direction: "above" };

  it("fires below-rules at/under the trigger, not over it", () => {
    expect(ruleShouldFire(rule(below), { wstETH: 2400 })).toBe(2400);
    expect(ruleShouldFire(rule(below), { wstETH: 2500 })).toBe(2500);
    expect(ruleShouldFire(rule(below), { wstETH: 2600 })).toBeNull();
  });

  it("fires above-rules at/over the trigger, not under it", () => {
    expect(ruleShouldFire(rule(above), { wstETH: 3600 })).toBe(3600);
    expect(ruleShouldFire(rule(above), { wstETH: 3400 })).toBeNull();
  });

  it("never fires on missing prices or malformed triggers", () => {
    expect(ruleShouldFire(rule(below), {})).toBeNull();
    expect(ruleShouldFire(rule(below), { wstETH: null as unknown as number })).toBeNull();
    expect(ruleShouldFire(rule({}), { wstETH: 1 })).toBeNull();
    expect(ruleShouldFire(rule({ market: "wstETH", priceUsd: "x", direction: "below" }), { wstETH: 1 })).toBeNull();
  });

  it("formats the trigger notice with market, price and side", () => {
    const msg = formatTriggerMessage(rule(below), 2400);
    expect(msg).toContain("wstETH");
    expect(msg).toContain("$2,400");
    expect(msg).toContain("long");
  });

  it("pauses after a bounded number of failures", () => {
    expect(MAX_FAILURES).toBe(3);
  });
});

describe("computePnl", () => {
  const snap: SnapshotRecord = {
    market: "wstETH",
    side: "long",
    positionId: 7,
    entryCollateral: 2,
    entryDebt: 3000,
    entrySpotUsd: 3000, // entry net = 2*3000 - 3000 = $3,000
    entryAt: new Date("2026-06-01T00:00:00Z"),
  };

  it("computes unrealized PnL vs the entry snapshot", () => {
    // now: 2 * 3200 - 3000 = $3,400 → +$400 (+13.3%)
    const pnl = computePnl(pos(), snap, { wstETH: 3200, FXUSD: 1 });
    expect(pnl).not.toBeNull();
    expect(pnl!.pnlUsd).toBeCloseTo(400, 6);
    expect(pnl!.pnlPct).toBeCloseTo((400 / 3000) * 100, 6);
    expect(pnl!.since.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("handles losses symmetrically", () => {
    const pnl = computePnl(pos(), snap, { wstETH: 2800, FXUSD: 1 });
    expect(pnl!.pnlUsd).toBeCloseTo(-400, 6);
  });

  it("omits PnL instead of guessing when anything is unpriced", () => {
    expect(computePnl(pos(), undefined, { wstETH: 3200 })).toBeNull();
    expect(computePnl(pos(), { ...snap, entrySpotUsd: null }, { wstETH: 3200 })).toBeNull();
    expect(computePnl(pos(), snap, null)).toBeNull();
    expect(computePnl(pos(), snap, {})).toBeNull();
  });

  it("values fxUSD debt at $1 when FXUSD itself is unpriced", () => {
    const pnl = computePnl(pos(), snap, { wstETH: 3200 });
    expect(pnl!.pnlUsd).toBeCloseTo(400, 6);
  });

  it("keys snapshots by market:side:positionId", () => {
    expect(snapshotKey(pos())).toBe("wstETH:long:7");
  });
});
