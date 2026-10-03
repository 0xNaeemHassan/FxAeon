import assert from "node:assert/strict";
import test from "node:test";
import { clampLeverage, leverageBoundsFromRatios, leverageBoundsFor, prepareLeverageReview, readLeverageBounds } from "../src/lib/fx/leverage";
import { positionPoolAddress } from "../src/lib/fx/policy";
import type { FxPublicClient } from "../src/lib/fx/types";

const POSITION_FLOWS = [
  { market: "ETH", side: "long", expected: { min: 1.1, max: 6.1 } },
  { market: "ETH", side: "short", expected: { min: 0.1, max: 6.0 } },
  { market: "BTC", side: "long", expected: { min: 1.1, max: 6.1 } },
  { market: "BTC", side: "short", expected: { min: 0.1, max: 6.0 } },
] as const;
const WAD = 10n ** 18n;

test("derives a conservative editable bound from live debt-ratio limits", () => {
  const long = leverageBoundsFromRatios(25_600_000_000_000_000n, 855_000_000_000_000_000n, "long");
  assert.equal(long.source, "live");
  assert.equal(long.min, 1.1);
  assert.equal(long.max, 6.1);

  const short = leverageBoundsFromRatios(90_909_090_909_090_909n, 875_000_000_000_000_000n, "short");
  assert.equal(short.min, 0.1);
  assert.equal(short.max, 6.0);
  // The displayed tenth stays below the guarded hard pool ratio after the
  // default 0.5% route slippage; the next tenth would cross the estimate.
  const guardNumerator = 9_900n * 9_950n;
  const guardDenominator = 10_000n * 10_050n;
  const guardedLongMax = 855_000_000_000_000_000n * guardNumerator / guardDenominator;
  assert.ok(51n * WAD <= guardedLongMax * 61n);
  assert.ok(52n * WAD > guardedLongMax * 62n);
  const guardedShortMax = 875_000_000_000_000_000n * guardNumerator / guardDenominator;
  assert.ok(60n * WAD <= guardedShortMax * 70n);
  assert.ok(61n * WAD > guardedShortMax * 71n);
  assert.equal(leverageBoundsFromRatios(25_600_000_000_000_000n, 855_000_000_000_000_000n, "long", 2).max, 5.3);
  assert.equal(leverageBoundsFromRatios(90_909_090_909_090_909n, 875_000_000_000_000_000n, "short", 2).max, 4.9);
});

test("clamps pasted leverage values to the current pool guard", () => {
  const bounds = leverageBoundsFor("ETH", "long");
  assert.equal(clampLeverage(20, bounds), bounds.max);
  assert.equal(clampLeverage(0.01, bounds), bounds.min);
  assert.equal(clampLeverage(Number.NaN, bounds), bounds.min);
  // A previously selected legacy ceiling is clamped immediately when the
  // conservative live/fallback ceiling arrives after a market/side change.
  assert.equal(clampLeverage(6.8, { min: 1.1, max: 6.1 }), 6.1);
  assert.equal(clampLeverage(6.9, { min: 0.1, max: 6.0 }), 6.0);
  assert.equal(clampLeverage(6.1, leverageBoundsFor("ETH", "long", 2)), 5.3);
  assert.equal(clampLeverage(6, leverageBoundsFor("ETH", "short", 2)), 4.9);
});

test("defines a safe fallback range for all four position flows", () => {
  for (const flow of POSITION_FLOWS) {
    const bounds = leverageBoundsFor(flow.market, flow.side);
    assert.deepEqual(bounds, { ...flow.expected, source: "fallback" });
    assert.equal(clampLeverage(-1, bounds), flow.expected.min);
    assert.equal(clampLeverage(20, bounds), flow.expected.max);
  }
});

test("reads each position flow from its canonical pool and proves the supplied client chain", async () => {
  const calls: Array<{ address: string; functionName: string }> = [];
  const client = {
    chain: { id: 1 },
    getChainId: async () => 1,
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      calls.push({ address, functionName });
      return [25_600_000_000_000_000n, 855_000_000_000_000_000n] as const;
    },
  } as unknown as FxPublicClient;

  for (const flow of POSITION_FLOWS) {
    const bounds = await readLeverageBounds(flow.market, flow.side, client);
    assert.equal(bounds.source, "live");
    assert.equal(calls.at(-1)?.address.toLowerCase(), positionPoolAddress(flow.market, flow.side).toLowerCase());
    assert.equal(calls.at(-1)?.functionName, "getDebtRatioRange");
  }
  assert.equal(calls.length, POSITION_FLOWS.length);

  let read = false;
  const wrongChain = {
    chain: { id: 8453 },
    getChainId: async () => 8453,
    readContract: async () => { read = true; return [1n, 2n] as const; },
  } as unknown as FxPublicClient;
  await assert.rejects(() => readLeverageBounds("ETH", "long", wrongChain), /expected 1/);
  assert.equal(read, false);
});

test("rejects malformed or unusably narrow debt-ratio ranges", () => {
  assert.throws(() => leverageBoundsFromRatios(0n, 0n, "short"), /invalid debt-ratio range/);
  assert.throws(() => leverageBoundsFromRatios(2n, 1n, "long"), /invalid debt-ratio range/);
  assert.throws(() => leverageBoundsFromRatios(1n, 10n ** 18n, "long"), /invalid debt-ratio range/);
  assert.throws(() => leverageBoundsFromRatios(500_000_000_000_000_000n, 510_000_000_000_000_000n, "long"), /safe 0.1x target/);
});

test("prices in parallel with live-bound refresh and stops a newly out-of-range review", async () => {
  const events: string[] = [];
  const adjusted = await prepareLeverageReview({
    leverage: 6,
    currentBounds: leverageBoundsFor("ETH", "long"),
    readBounds: async () => {
      events.push("bounds");
      return { min: 1.2, max: 4.9, source: "live" };
    },
    buildPlan: async () => {
      events.push("plan");
      return "priced";
    },
  });
  assert.deepEqual(events, ["plan", "bounds"]);
  assert.deepEqual(adjusted, {
    adjusted: true,
    bounds: { min: 1.2, max: 4.9, source: "live" },
    leverage: 4.9,
    plan: null,
  });

  const fallback = leverageBoundsFor("BTC", "short");
  const prepared = await prepareLeverageReview({
    leverage: 0.5,
    currentBounds: fallback,
    readBounds: async () => { throw new Error("RPC offline"); },
    buildPlan: async () => "priced",
  });
  assert.deepEqual(prepared, { adjusted: false, bounds: fallback, leverage: 0.5, plan: "priced" });
});
