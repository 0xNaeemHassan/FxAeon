import { describe, it, expect } from "vitest";
import { computeArbSignal, formatArbSignal } from "@fxaeon/shared";
describe("computeArbSignal", () => {
  it("flags MINT_THEN_SELL when market > mint cost beyond threshold", () => {
    const s = computeArbSignal({ navUsd: 1.0, marketUsd: 1.01, mintFeeBps: 10 });
    expect(s.direction).toBe("MINT_THEN_SELL");
    // mintCost = 1.001; edge = (1.01-1.001)/1.001 ≈ 0.899% ≈ 90 bps
    expect(s.edgeBps).toBeGreaterThanOrEqual(85);
    expect(s.actionable).toBe(true);
  });

  it("flags BUY_THEN_REDEEM when market < redeem value beyond threshold", () => {
    const s = computeArbSignal({ navUsd: 1.0, marketUsd: 0.985, redeemFeeBps: 10 });
    expect(s.direction).toBe("BUY_THEN_REDEEM");
    // redeemValue = 0.999; edge = (0.999-0.985)/0.985 ≈ 1.42%
    expect(s.edgePct).toBeGreaterThan(1);
    expect(s.actionable).toBe(true);
  });

  it("returns NONE within the threshold band", () => {
    const s = computeArbSignal({ navUsd: 1.0, marketUsd: 1.0005, mintFeeBps: 10, thresholdBps: 30 });
    expect(s.direction).toBe("NONE");
    expect(s.actionable).toBe(false);
  });

  it("respects a custom actionable threshold", () => {
    // 90 bps edge, but threshold 200 → not actionable, direction still set
    const s = computeArbSignal({ navUsd: 1, marketUsd: 1.009, thresholdBps: 200 });
    expect(s.direction).toBe("MINT_THEN_SELL");
    expect(s.actionable).toBe(false);
  });

  it("applies fees to mint cost and redeem value", () => {
    const s = computeArbSignal({ navUsd: 1, marketUsd: 1, mintFeeBps: 50, redeemFeeBps: 30 });
    expect(s.mintCostUsd).toBeCloseTo(1.005, 6);
    expect(s.redeemValueUsd).toBeCloseTo(0.997, 6);
    expect(s.direction).toBe("NONE"); // market sits between, no edge
  });

  it("throws on invalid inputs", () => {
    expect(() => computeArbSignal({ navUsd: 0, marketUsd: 1 })).toThrow();
    expect(() => computeArbSignal({ navUsd: 1, marketUsd: NaN })).toThrow();
    expect(() => computeArbSignal({ navUsd: 1, marketUsd: 1, mintFeeBps: -1 })).toThrow();
  });

  it("formats actionable and idle signals distinctly", () => {
    const hot = computeArbSignal({ navUsd: 1, marketUsd: 1.02 });
    expect(formatArbSignal(hot, "fxUSD")).toMatch(/MINT then SELL/);
    const cold = computeArbSignal({ navUsd: 1, marketUsd: 1.0001 });
    expect(formatArbSignal(cold)).toMatch(/No actionable/);
  });
});
