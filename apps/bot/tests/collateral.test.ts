import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Collateral module tests — Phase 2.
 * Tests token lists per market, balance formatting, and multicall structure.
 */

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    multicall: vi.fn(),
    getBalance: vi.fn(),
  })),
  http: vi.fn(),
  formatEther: vi.fn((val: bigint) => (Number(val) / 1e18).toString()),
  formatUnits: vi.fn((val: bigint, decimals: number) =>
    (Number(val) / Math.pow(10, decimals)).toString()
  ),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1, name: "mainnet" },
}));

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
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  MARKETS: ["wstETH", "WBTC"],
}));

// Import after mocks
import { getCollateralTokens, formatBalance, type CollateralBalance } from "../src/core/collateral.js";

describe("Collateral module", () => {
  describe("getCollateralTokens", () => {
    it("returns correct tokens for ETH market (wstETH)", () => {
      const tokens = getCollateralTokens("wstETH");
      const symbols = tokens.map((t) => t.symbol);
      expect(symbols).toContain("fxUSD");
      expect(symbols).toContain("wstETH");
      expect(symbols).toContain("stETH");
      expect(symbols).toContain("WETH");
      expect(symbols).toContain("ETH");
      // BTC should NOT be in ETH market
      expect(symbols).not.toContain("WBTC");
    });

    it("returns correct tokens for BTC market (WBTC)", () => {
      const tokens = getCollateralTokens("WBTC");
      const symbols = tokens.map((t) => t.symbol);
      expect(symbols).toContain("fxUSD");
      expect(symbols).toContain("WBTC");
      // ETH-specific tokens should NOT be in BTC market
      expect(symbols).not.toContain("wstETH");
      expect(symbols).not.toContain("stETH");
    });

    it("ETH market has native ETH token", () => {
      const tokens = getCollateralTokens("wstETH");
      const nativeToken = tokens.find((t) => t.isNative);
      expect(nativeToken).toBeDefined();
      expect(nativeToken!.symbol).toBe("ETH");
    });

    it("BTC market has no native token", () => {
      const tokens = getCollateralTokens("WBTC");
      const nativeToken = tokens.find((t) => t.isNative);
      expect(nativeToken).toBeUndefined();
    });

    it("WBTC has 8 decimals", () => {
      const tokens = getCollateralTokens("WBTC");
      const wbtc = tokens.find((t) => t.symbol === "WBTC");
      expect(wbtc!.decimals).toBe(8);
    });

    it("wstETH has 18 decimals", () => {
      const tokens = getCollateralTokens("wstETH");
      const wsteth = tokens.find((t) => t.symbol === "wstETH");
      expect(wsteth!.decimals).toBe(18);
    });
  });

  describe("formatBalance", () => {
    it("formats non-empty balance correctly", () => {
      const bal: CollateralBalance = {
        symbol: "wstETH",
        address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
        decimals: 18,
        balanceRaw: 1_500_000_000_000_000_000n,
        balanceHuman: 1.5,
        balanceUsd: 4500,
        isEmpty: false,
      };
      const result = formatBalance(bal);
      expect(result).toContain("wstETH");
      expect(result).toContain("1.5000");
      expect(result).toContain("$4,500");
    });

    it("formats empty balance as Insufficient", () => {
      const bal: CollateralBalance = {
        symbol: "WBTC",
        address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
        decimals: 8,
        balanceRaw: 0n,
        balanceHuman: 0,
        balanceUsd: null,
        isEmpty: true,
      };
      const result = formatBalance(bal);
      expect(result).toBe("WBTC: Insufficient");
    });

    it("formats large balance with commas", () => {
      const bal: CollateralBalance = {
        symbol: "fxUSD",
        address: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
        decimals: 18,
        balanceRaw: 50_000_000_000_000_000_000_000n,
        balanceHuman: 50000,
        balanceUsd: 50000,
        isEmpty: false,
      };
      const result = formatBalance(bal);
      expect(result).toContain("50,000");
    });
  });
});
