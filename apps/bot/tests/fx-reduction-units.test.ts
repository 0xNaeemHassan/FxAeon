import { describe, expect, it, vi } from "vitest";
import {
  calculateSdkReductionAmountWei,
  getSdkReductionAmountWei,
} from "../src/fx/index.js";

const WAD = 10n ** 18n;

describe("fx-sdk reducePosition amount units", () => {
  it("uses raw collateral units for partial longs", () => {
    expect(
      calculateSdkReductionAmountWei({
        market: "wstETH",
        side: "long",
        rawCollateralWei: 4n * WAD,
        rawDebtWei: 7_000n * WAD,
        fractionBps: 2_500,
      })
    ).toBe(1n * WAD);
  });

  it("uses raw debt units for partial BTC shorts", () => {
    expect(
      calculateSdkReductionAmountWei({
        market: "WBTC",
        side: "short",
        rawCollateralWei: 40_000n * WAD,
        rawDebtWei: 500_000_000_000_000_000n,
        fractionBps: 5_000,
      })
    ).toBe(250_000_000_000_000_000n);
  });

  it("normalizes wstETH short debt with the live-rate unit before taking the fraction", () => {
    expect(
      calculateSdkReductionAmountWei({
        market: "wstETH",
        side: "short",
        rawCollateralWei: 20_000n * WAD,
        rawDebtWei: 8n * WAD,
        wstEthRateWei: 1_250_000_000_000_000_000n,
        fractionBps: 2_500,
      })
    ).toBe(2_500_000_000_000_000_000n);
  });

  it("reads stEthPerToken only for partial wstETH shorts", async () => {
    const readContract = vi.fn().mockResolvedValue(1_250_000_000_000_000_000n);
    const amount = await getSdkReductionAmountWei({
      client: { readContract } as never,
      market: "wstETH",
      side: "short",
      rawCollateralWei: 20_000n * WAD,
      rawDebtWei: 8n * WAD,
      fractionBps: 2_500,
    });

    expect(amount).toBe(2_500_000_000_000_000_000n);
    expect(readContract).toHaveBeenCalledOnce();
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "stEthPerToken" })
    );
  });

  it("uses a positive ignored sentinel for full closes without a rate read", async () => {
    const readContract = vi.fn();
    const amount = await getSdkReductionAmountWei({
      client: { readContract } as never,
      market: "wstETH",
      side: "short",
      rawCollateralWei: 20_000n * WAD,
      rawDebtWei: 8n * WAD,
      fractionBps: 10_000,
    });

    expect(amount).toBe(1n);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("fails closed when the short rate or fraction is invalid", () => {
    expect(() =>
      calculateSdkReductionAmountWei({
        market: "wstETH",
        side: "short",
        rawCollateralWei: WAD,
        rawDebtWei: WAD,
        fractionBps: 2_500,
      })
    ).toThrow(/rate/i);
    expect(() =>
      calculateSdkReductionAmountWei({
        market: "WBTC",
        side: "short",
        rawCollateralWei: WAD,
        rawDebtWei: WAD,
        fractionBps: 10_001,
      })
    ).toThrow(/fraction/i);
  });
});
