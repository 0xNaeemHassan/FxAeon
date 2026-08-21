import { describe, expect, it, vi } from "vitest";
import type { FxSdk } from "@aladdindao/fx-sdk";
import { ADDRESSES } from "@fxaeon/shared";
import {
  quoteAdjustPositionLeverage,
  quoteClosePosition,
  quoteOpenPosition,
} from "../src/fx/index.js";

const USER = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

function result(routeType = "FxRoute", minOut?: string) {
  return {
    positionId: 1,
    slippage: 0.5,
    routes: [{
      routeType,
      leverage: 2,
      executionPrice: "1",
      ...(minOut === undefined ? {} : { minOut }),
      colls: "1",
      debts: "1",
      txs: [{ to: ADDRESSES.ROUTER, data: "0x" as const, value: 0n }],
    }],
  };
}

describe("protocol-native SDK route boundary", () => {
  it("requests only FxRoute for open/increase quotes", async () => {
    const increasePosition = vi.fn().mockResolvedValue(result());
    await quoteOpenPosition({
      sdk: { increasePosition } as unknown as FxSdk,
      userAddress: USER,
      market: "wstETH",
      side: "long",
      leverage: 2,
      amountWei: 1n,
      slippagePercent: 0.5,
    });
    expect(increasePosition).toHaveBeenCalledWith(expect.objectContaining({ targets: ["FxRoute"] }));
  });

  it("requests only FxRoute for reduce/close quotes", async () => {
    const reducePosition = vi.fn().mockResolvedValue(result("FxRoute", "123456789012345678"));
    const quote = await quoteClosePosition({
      sdk: { reducePosition } as unknown as FxSdk,
      userAddress: USER,
      market: "wstETH",
      side: "long",
      positionId: 1,
      amountWei: 1n,
      slippagePercent: 0.5,
    });
    expect(reducePosition).toHaveBeenCalledWith(expect.objectContaining({ targets: ["FxRoute"] }));
    expect(quote.routes[0]?.minOut).toBe("123456789012345678");
  });

  it("fails closed when a reduce route drops or corrupts the SDK minimum output", async () => {
    for (const minOut of [undefined, "", "-1", "0", "1.5"] as const) {
      const reducePosition = vi.fn().mockResolvedValue(result("FxRoute", minOut));
      await expect(quoteClosePosition({
        sdk: { reducePosition } as unknown as FxSdk,
        userAddress: USER,
        market: "wstETH",
        side: "long",
        positionId: 1,
        amountWei: 1n,
        slippagePercent: 0.5,
      })).rejects.toThrow(/without a valid minimum output/i);
    }
  });

  it("requests only FxRoute for leverage adjustment quotes", async () => {
    const adjustPositionLeverage = vi.fn().mockResolvedValue(result("FxRoute"));
    const quote = await quoteAdjustPositionLeverage({
      sdk: { adjustPositionLeverage } as unknown as FxSdk,
      userAddress: USER,
      market: "WBTC",
      side: "long",
      positionId: 1,
      leverage: 2,
      slippagePercent: 0.5,
    });
    expect(adjustPositionLeverage).toHaveBeenCalledWith(expect.objectContaining({ targets: ["FxRoute"] }));
    expect(quote.routes[0]?.routeType).toBe("FxRoute");
  });

  it("fails closed if the SDK ever returns a remote embedded aggregator", async () => {
    const increasePosition = vi.fn().mockResolvedValue(result("Odos"));
    await expect(quoteOpenPosition({
      sdk: { increasePosition } as unknown as FxSdk,
      userAddress: USER,
      market: "wstETH",
      side: "long",
      leverage: 2,
      amountWei: 1n,
      slippagePercent: 0.5,
    })).rejects.toThrow(/unpinned embedded route/i);
  });

  it("fails closed if the SDK returns a route-table generation the signer has not pinned", async () => {
    const increasePosition = vi.fn().mockResolvedValue(result("FxRoute 2"));
    await expect(quoteOpenPosition({
      sdk: { increasePosition } as unknown as FxSdk,
      userAddress: USER,
      market: "WBTC",
      side: "long",
      leverage: 2,
      amountWei: 1n,
      slippagePercent: 0.5,
    })).rejects.toThrow(/unpinned embedded route/i);
  });
});
