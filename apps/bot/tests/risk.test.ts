import { describe, it, expect } from "vitest";
import { 
  RISK_PARAMS, 
  ADDRESSES, 
  computeLiquidationPrice, 
  computeHealthPercent,
  HEALTH_LEVELS 
} from "@fxbot/shared";

describe("Risk Parameters", () => {
  it("should have correct locked values from spec", () => {
    expect(RISK_PARAMS.DEBT_RATIO_LOWER).toBe(0.0909);
    expect(RISK_PARAMS.DEBT_RATIO_UPPER).toBe(0.8666);
    expect(RISK_PARAMS.REBALANCE_THRESHOLD).toBe(0.88);
    expect(RISK_PARAMS.LIQUIDATION_THRESHOLD).toBe(0.95);
    expect(RISK_PARAMS.REBALANCE_BONUS).toBe(0.025);
    expect(RISK_PARAMS.LIQUIDATE_BONUS).toBe(0.04);
    expect(RISK_PARAMS.OPEN_RATIO_BASE_WSTETH).toBe(0.001);
    expect(RISK_PARAMS.OPEN_RATIO_BASE_WBTC).toBe(0.003);
    expect(RISK_PARAMS.OPEN_RATIO_STEP).toBe(0.003);
    expect(RISK_PARAMS.CLOSE_FEE).toBe(0.001);
    expect(RISK_PARAMS.MAX_LEVERAGE_LONG).toBe(7);
    expect(RISK_PARAMS.MAX_LEVERAGE_SHORT).toBe(3);
    expect(RISK_PARAMS.MIN_LEVERAGE).toBe(1.1);
    expect(RISK_PARAMS.SLIPPAGE_DEFAULT_BPS).toBe(50);
  });

  it("should have correct contract addresses", () => {
    expect(ADDRESSES.ROUTER).toBe("0x33636D49FbefBE798e15e7F356E8DBef543CC708");
    expect(ADDRESSES.LONG_POOL_MANAGER).toBe("0x250893CA4Ba5d05626C785e8da758026928FCD24");
    expect(ADDRESSES.SHORT_POOL_MANAGER).toBe("0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D");
    expect(ADDRESSES.WSTETH_LONG_POOL).toBe("0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8");
    expect(ADDRESSES.WBTC_LONG_POOL).toBe("0xAB709e26Fa6B0A30c119D8c55B887DeD24952473");
    expect(ADDRESSES.WSTETH_SHORT_POOL).toBe("0x25707b9e6690B52C60aE6744d711cf9C1dFC1876");
    expect(ADDRESSES.WBTC_SHORT_POOL).toBe("0xA0cC8162c523998856D59065fAa254F87D20A5b0");
    expect(ADDRESSES.LIMIT_ORDER_MANAGER).toBe("0x112873b395B98287F3A4db266a58e2D01779Ad96");
    expect(ADDRESSES.FXUSD).toBe("0x085780639CC2cACd35E474e71f4d000e2405d8f6");
    expect(ADDRESSES.FXN).toBe("0x365AccFCa291e7D3914637ABf1F7635dB165Bb09");
    expect(ADDRESSES.FXSAVE).toBe("0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39");
    expect(ADDRESSES.VEFXN).toBe("0xEC6B8A3F3605B083F7044C0F31f2cac0caf1d469");
  });

  it("should compute liquidation price correctly for long", () => {
    const coll = BigInt("1000000000000000000"); // 1 ETH
    const debt = BigInt("500000000000000000");  // 0.5 ETH worth
    const price = computeLiquidationPrice(coll, debt, "long");
    expect(price).toBeGreaterThan(0);
  });

  it("should compute health percent correctly", () => {
    const health = computeHealthPercent(0.8);
    expect(health).toBeCloseTo(0.8 / 0.95, 5);
  });

  it("should identify health levels", () => {
    expect(HEALTH_LEVELS.SAFE).toBe(0.70);
    expect(HEALTH_LEVELS.WARNING).toBe(0.85);
    expect(HEALTH_LEVELS.URGENT).toBe(0.95);
  });
});
