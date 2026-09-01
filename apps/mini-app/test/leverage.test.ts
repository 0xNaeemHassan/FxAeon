import assert from "node:assert/strict";
import test from "node:test";
import { clampLeverage, leverageBoundsFromRatios, leverageBoundsFor } from "../src/lib/fx/leverage";

test("derives a conservative editable bound from live debt-ratio limits", () => {
  const long = leverageBoundsFromRatios(25_600_000_000_000_000n, 855_000_000_000_000_000n, "long");
  assert.equal(long.source, "live");
  assert.equal(long.min, 1.1);
  assert.equal(long.max, 6.8);

  const short = leverageBoundsFromRatios(90_909_090_909_090_909n, 875_000_000_000_000_000n, "short");
  assert.equal(short.min, 0.1);
  assert.equal(short.max, 6.9);
});

test("clamps pasted leverage values to the current pool guard", () => {
  const bounds = leverageBoundsFor("ETH", "long");
  assert.equal(clampLeverage(20, bounds), bounds.max);
  assert.equal(clampLeverage(0.01, bounds), bounds.min);
  assert.equal(clampLeverage(Number.NaN, bounds), bounds.min);
  assert.equal(leverageBoundsFromRatios(0n, 0n, "short").max, 0.1);
});
