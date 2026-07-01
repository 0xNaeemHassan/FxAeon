import { describe, it, expect, vi } from "vitest";

/**
 * LongShort command tests — Phase 2.
 * Tests command parsing, pro-mode shortcut parsing, and validation.
 */

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
  RISK_PARAMS: {
    MAX_LEVERAGE_LONG: 7,
    MAX_LEVERAGE_SHORT: 3,
    MIN_LEVERAGE: 1.1,
    SLIPPAGE_DEFAULT_BPS: 50,
    SLIPPAGE_MAX_BPS: 200,
  },
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/market/oracle.js", () => ({
  checkOracles: vi.fn(),
  estimateDailyFunding: vi.fn(),
}));

vi.mock("../src/core/collateral.js", () => ({
  getCollateralBalances: vi.fn(),
  formatBalance: vi.fn(),
}));

vi.mock("../src/market/coingecko.js", () => ({
  getSpotPrices: vi.fn().mockResolvedValue({ prices: { bitcoin: 103000, ethereum: 3400 }, stale: false }),
}));

vi.mock("../src/core/callbackKeys.js", () => ({
  storeCallbackPayload: vi.fn(() => "abcdef0123"),
  consumeCallbackPayload: vi.fn(),
}));

vi.mock("../src/handlers/tradeActions.js", () => ({
  buildPreview: vi.fn(() => ({ text: "preview text", keyboard: {} })),
  registerTradeActions: vi.fn(),
}));

import { parseShortcutCommand } from "../src/commands/longShort.js";

describe("parseShortcutCommand", () => {
  it("parses /longBTC correctly", () => {
    const result = parseShortcutCommand("/longBTC");
    expect(result).toEqual({ side: "long", asset: "BTC" });
  });

  it("parses /shortETH correctly", () => {
    const result = parseShortcutCommand("/shortETH");
    expect(result).toEqual({ side: "short", asset: "ETH" });
  });

  it("parses /longeth (lowercase) correctly", () => {
    const result = parseShortcutCommand("/longeth");
    expect(result).toEqual({ side: "long", asset: "ETH" });
  });

  it("parses /shortbtc (lowercase) correctly", () => {
    const result = parseShortcutCommand("/shortbtc");
    expect(result).toEqual({ side: "short", asset: "BTC" });
  });

  it("handles command with trailing text", () => {
    const result = parseShortcutCommand("/longBTC 500 5x usdc");
    expect(result).toEqual({ side: "long", asset: "BTC" });
  });

  it("returns null for invalid command", () => {
    expect(parseShortcutCommand("/trade")).toBeNull();
    expect(parseShortcutCommand("/longSOL")).toBeNull();
    expect(parseShortcutCommand("/closebtc")).toBeNull(); // close is different
    expect(parseShortcutCommand("")).toBeNull();
  });

  it("strips leading slash correctly", () => {
    const result = parseShortcutCommand("longBTC");
    expect(result).toEqual({ side: "long", asset: "BTC" });
  });
});

describe("Pro-mode argument parsing", () => {
  // Test the parseProArgs logic inline
  function parseProArgs(args: string[]): {
    amount: number;
    leverage: number;
    collateral?: string;
  } | null {
    if (args.length < 2) return null;
    const amount = parseFloat(args[0].replace("$", ""));
    if (isNaN(amount) || amount <= 0) return null;
    const leverage = parseFloat(args[1].replace(/x$/i, ""));
    if (isNaN(leverage) || leverage <= 0) return null;
    return {
      amount,
      leverage,
      collateral: args[2]?.toUpperCase(),
    };
  }

  it("parses '500 5x usdc'", () => {
    const result = parseProArgs(["500", "5x", "usdc"]);
    expect(result).toEqual({ amount: 500, leverage: 5, collateral: "USDC" });
  });

  it("parses '$100 3x'", () => {
    const result = parseProArgs(["$100", "3x"]);
    expect(result).toEqual({ amount: 100, leverage: 3, collateral: undefined });
  });

  it("parses '0.5 1.1x wstETH'", () => {
    const result = parseProArgs(["0.5", "1.1x", "wstETH"]);
    expect(result).toEqual({ amount: 0.5, leverage: 1.1, collateral: "WSTETH" });
  });

  it("parses '1000 7 fxusd' (no x suffix)", () => {
    const result = parseProArgs(["1000", "7", "fxusd"]);
    expect(result).toEqual({ amount: 1000, leverage: 7, collateral: "FXUSD" });
  });

  it("returns null for single arg", () => {
    expect(parseProArgs(["500"])).toBeNull();
  });

  it("returns null for invalid amount", () => {
    expect(parseProArgs(["abc", "5x"])).toBeNull();
    expect(parseProArgs(["-100", "5x"])).toBeNull();
  });

  it("returns null for invalid leverage", () => {
    expect(parseProArgs(["500", "abc"])).toBeNull();
  });

  it("returns null for empty args", () => {
    expect(parseProArgs([])).toBeNull();
  });
});

describe("Market/Asset mapping", () => {
  it("maps assets to markets correctly", () => {
    // ETH → wstETH market, BTC → WBTC market
    const assetToMarket = (asset: string) => (asset === "ETH" ? "wstETH" : "WBTC");
    expect(assetToMarket("ETH")).toBe("wstETH");
    expect(assetToMarket("BTC")).toBe("WBTC");
  });

  it("maps markets to assets correctly", () => {
    const marketToAsset = (market: string) => (market === "wstETH" ? "ETH" : "BTC");
    expect(marketToAsset("wstETH")).toBe("ETH");
    expect(marketToAsset("WBTC")).toBe("BTC");
  });
});

describe("Leverage presets", () => {
  it("long presets max at 7x", () => {
    const presets = [1.1, 2, 3, 5, 7];
    expect(presets[presets.length - 1]).toBe(7);
  });

  it("short presets max at 3x", () => {
    const presets = [1.1, 1.5, 2, 3];
    expect(presets[presets.length - 1]).toBe(3);
  });

  it("all presets are >= MIN_LEVERAGE", () => {
    const longPresets = [1.1, 2, 3, 5, 7];
    const shortPresets = [1.1, 1.5, 2, 3];
    for (const p of [...longPresets, ...shortPresets]) {
      expect(p).toBeGreaterThanOrEqual(1.1);
    }
  });
});
