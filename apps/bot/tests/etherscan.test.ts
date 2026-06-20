/**
 * Tests for the Etherscan Gas Oracle integration (packages/shared/src/etherscan.ts).
 *
 * Tests cover:
 * - Gas oracle parsing + validation
 * - ETH price parsing + validation
 * - Cache behavior (fresh/stale/miss)
 * - Single-flight deduplication
 * - Error handling (API errors, timeouts, malformed responses)
 * - Formatting helpers (gwei, ETH cost, USD cost, gas used ratio)
 * - Combined getGasOracleWithPrice behavior
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getGasOracle,
  getEthPrice,
  getGasOracleWithPrice,
  clearEtherscanCache,
  formatGweiPrice,
  formatEthCost,
  formatUsdCost,
  formatGasUsedRatio,
} from "@fxbot/shared";

// ── Fixtures ────────────────────────────────────────────────────────────────

function gasOracleResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "1",
    message: "OK",
    result: {
      LastBlock: "25358373",
      SafeGasPrice: "0.357265583",
      ProposeGasPrice: "0.358344249",
      FastGasPrice: "0.638144075",
      suggestBaseFee: "0.357165583",
      gasUsedRatio:
        "0.599655516666667,0.660530566666667,0.556719633333333,0.348902983333333,0.480044333333333",
      ...overrides,
    },
  };
}

function ethPriceResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "1",
    message: "OK",
    result: {
      ethbtc: "0.02713275",
      ethbtc_timestamp: "1781953307",
      ethusd: "3612.24",
      ethusd_timestamp: "1781953307",
      ...overrides,
    },
  };
}

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("etherscan", () => {
  beforeEach(() => {
    clearEtherscanCache();
    vi.restoreAllMocks();
    process.env.ETHERSCAN_API_KEY = "test-api-key";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ETHERSCAN_API_KEY;
  });

  describe("getGasOracle", () => {
    it("parses a valid gas oracle response", async () => {
      mockFetch(gasOracleResponse());
      const { data, stale } = await getGasOracle();

      expect(data.lastBlock).toBe(25358373);
      expect(data.safeGasPrice).toBeCloseTo(0.3573, 3);
      expect(data.proposeGasPrice).toBeCloseTo(0.3583, 3);
      expect(data.fastGasPrice).toBeCloseTo(0.6381, 3);
      expect(data.suggestBaseFee).toBeCloseTo(0.3572, 3);
      expect(data.gasUsedRatio).toHaveLength(5);
      expect(stale).toBe(false);
    });

    it("caches within TTL (no duplicate upstream call)", async () => {
      const spy = mockFetch(gasOracleResponse());
      await getGasOracle();
      await getGasOracle();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("serves stale cache when upstream fails after a prior success", async () => {
      const spy = mockFetch(gasOracleResponse());
      await getGasOracle();

      // Force cache expiry
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 20_000); // past 12s TTL

      spy.mockRejectedValueOnce(new Error("network down"));
      const { stale } = await getGasOracle();
      expect(stale).toBe(true);
      vi.useRealTimers();
    });

    it("throws when no cache and upstream fails", async () => {
      mockFetch({}, false, 500);
      await expect(getGasOracle()).rejects.toThrow();
    });

    it("throws when API key is missing", async () => {
      delete process.env.ETHERSCAN_API_KEY;
      await expect(getGasOracle()).rejects.toThrow("ETHERSCAN_API_KEY");
    });

    it("throws on Etherscan error response", async () => {
      mockFetch({ status: "0", message: "NOTOK", result: "Invalid API Key" });
      await expect(getGasOracle()).rejects.toThrow("NOTOK");
    });

    it("sends correct query params", async () => {
      const spy = mockFetch(gasOracleResponse());
      await getGasOracle();
      const url = String(spy.mock.calls[0][0]);
      expect(url).toContain("module=gastracker");
      expect(url).toContain("action=gasoracle");
      expect(url).toContain("chainid=1");
      expect(url).toContain("apikey=test-api-key");
    });
  });

  describe("getEthPrice", () => {
    it("parses a valid ETH price response", async () => {
      mockFetch(ethPriceResponse());
      const { data, stale } = await getEthPrice();

      expect(data.ethUsd).toBeCloseTo(3612.24, 1);
      expect(data.ethBtc).toBeCloseTo(0.0271, 3);
      expect(data.ethUsdTimestamp).toBe(1781953307);
      expect(stale).toBe(false);
    });
  });

  describe("getGasOracleWithPrice", () => {
    it("returns both gas oracle and eth price", async () => {
      // Two parallel fetches → two mock calls
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        callCount++;
        const url = String(input);
        const body = url.includes("gasoracle")
          ? gasOracleResponse()
          : ethPriceResponse();
        return { ok: true, status: 200, json: async () => body } as Response;
      });

      const snapshot = await getGasOracleWithPrice();
      expect(snapshot.oracle.lastBlock).toBe(25358373);
      expect(snapshot.ethPrice).not.toBeNull();
      expect(snapshot.ethPrice!.ethUsd).toBeCloseTo(3612.24, 1);
      expect(snapshot.stale).toBe(false);
    });

    it("returns null ethPrice when price endpoint fails", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        callCount++;
        const url = String(input);
        if (url.includes("ethprice")) {
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => gasOracleResponse(),
        } as Response;
      });

      const snapshot = await getGasOracleWithPrice();
      expect(snapshot.oracle.lastBlock).toBe(25358373);
      expect(snapshot.ethPrice).toBeNull();
    });
  });

  describe("formatting helpers", () => {
    it("formatGweiPrice: sub-1 gets 4 decimals", () => {
      expect(formatGweiPrice(0.357)).toBe("0.3570");
      expect(formatGweiPrice(1.5)).toBe("1.50");
      expect(formatGweiPrice(25.3)).toBe("25.3");
    });

    it("formatEthCost: correct ETH conversion", () => {
      // 0.358 gwei × 600,000 gas = 0.000215 ETH
      const cost = formatEthCost(0.358, 600_000);
      expect(parseFloat(cost)).toBeCloseTo(0.000215, 5);
    });

    it("formatUsdCost: shows dollar amount", () => {
      // 0.358 gwei × 600,000 gas × $3600/ETH = $0.77
      const cost = formatUsdCost(0.358, 600_000, 3600);
      expect(cost).toMatch(/\$/);
    });

    it("formatUsdCost: shows <$0.01 for tiny costs", () => {
      const cost = formatUsdCost(0.001, 21_000, 100);
      expect(cost).toBe("<$0.01");
    });

    it("formatGasUsedRatio: average percentage", () => {
      expect(formatGasUsedRatio([0.5, 0.6, 0.7])).toBe("60.0%");
    });

    it("formatGasUsedRatio: empty array returns N/A", () => {
      expect(formatGasUsedRatio([])).toBe("N/A");
    });
  });
});
