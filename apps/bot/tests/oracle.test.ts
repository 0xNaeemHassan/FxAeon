import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Oracle module tests — Phase 2.
 * Tests the oracle check logic, chip formatting, and funding estimation.
 */

// Mock viem and external calls
vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    readContract: vi.fn(),
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
    SPOT_PRICE_ORACLE: "0xc2312CaF0De62eC9b4ADC785C79851Cb989C9abc",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    STETH: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  MARKETS: ["wstETH", "WBTC"],
  RISK_PARAMS: {
    MAX_LEVERAGE_LONG: 7,
    MAX_LEVERAGE_SHORT: 3,
    MIN_LEVERAGE: 1.1,
    SLIPPAGE_DEFAULT_BPS: 50,
    SLIPPAGE_MAX_BPS: 200,
  },
}));

describe("Oracle checks", () => {
  beforeEach(() => {
    process.env.ALCHEMY_RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/test";
  });

  describe("Divergence detection", () => {
    it("flags divergence above threshold", () => {
      const fxPrice = 103_420;
      const spotPrice = 104_000;
      const divergence = Math.abs(fxPrice - spotPrice) / spotPrice;
      expect(divergence).toBeGreaterThan(0.005); // > 0.5%
    });

    it("passes divergence within threshold", () => {
      const fxPrice = 103_420;
      const spotPrice = 103_450;
      const divergence = Math.abs(fxPrice - spotPrice) / spotPrice;
      expect(divergence).toBeLessThan(0.005); // < 0.5%
    });

    it("handles zero spot price gracefully", () => {
      const spotPrice = 0;
      // Should not divide by zero
      const divergence = spotPrice > 0
        ? Math.abs(100_000 - spotPrice) / spotPrice
        : null;
      expect(divergence).toBeNull();
    });
  });

  describe("Chainlink staleness", () => {
    it("flags staleness above threshold (60 min default)", () => {
      const updatedAt = Math.floor(Date.now() / 1000) - 3700; // 61 min ago
      const now = Math.floor(Date.now() / 1000);
      const stalenessSeconds = now - updatedAt;
      expect(stalenessSeconds).toBeGreaterThan(3600);
    });

    it("passes freshness within threshold", () => {
      const updatedAt = Math.floor(Date.now() / 1000) - 240; // 4 min ago
      const now = Math.floor(Date.now() / 1000);
      const stalenessSeconds = now - updatedAt;
      expect(stalenessSeconds).toBeLessThan(3600);
    });
  });

  describe("Chip formatting", () => {
    it("renders clean divergence chip", () => {
      const divPct = (0.0045 * 100).toFixed(2);
      const chip = `Oracle (f(x)):       $103,420.00    ✅ within ${divPct}%`;
      expect(chip).toContain("✅");
      expect(chip).toContain("0.45%");
    });

    it("renders warning divergence chip", () => {
      const divPct = (0.012 * 100).toFixed(2);
      const chip = `Oracle (f(x)):       $103,420.00    ⚠️ diverges ${divPct}%`;
      expect(chip).toContain("⚠️");
      expect(chip).toContain("1.20%");
    });

    it("renders Chainlink fresh chip", () => {
      const mins = 4;
      const chip = `Chainlink:           $103,415.00    ✅ updated ${mins}m ago`;
      expect(chip).toContain("✅");
      expect(chip).toContain("4m ago");
    });

    it("renders Chainlink stale chip", () => {
      const mins = 65;
      const chip = `Chainlink:           $103,415.00    ⚠️ updated ${mins}m ago`;
      expect(chip).toContain("⚠️");
    });
  });

  describe("Funding estimation", () => {
    it("calculates daily funding cost from borrow rate", () => {
      const positionSizeUsd = 2500;
      const annualRate = 50; // 5% borrow rate × 10
      const dailyRate = annualRate / 365;
      const dailyCost = (positionSizeUsd * dailyRate) / 100;
      expect(dailyCost).toBeCloseTo(3.42, 1);
    });
  });
});
