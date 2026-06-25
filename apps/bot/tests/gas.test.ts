/**
 * Tests for /gas command — Etherscan primary, RPC fallback, error handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gasCommand } from "../src/commands/gas";
import { clearEtherscanCache } from "@fxaeon/shared";

// Mock viem — /gas fallback calls createPublicClient
vi.mock("viem", () => ({
  formatGwei: (wei: bigint) => (Number(wei) / 1e9).toString(),
  createPublicClient: vi.fn(() => ({
    estimateFeesPerGas: vi.fn().mockResolvedValue({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    }),
  })),
  http: vi.fn(),
}));

// Mock the fx module
vi.mock("../src/fx/index.js", () => ({
  createPublicClientForUser: vi.fn(() => ({
    estimateFeesPerGas: vi.fn().mockResolvedValue({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    }),
  })),
}));

function gasOracleResponse() {
  return {
    status: "1",
    message: "OK",
    result: {
      LastBlock: "25358373",
      SafeGasPrice: "0.357",
      ProposeGasPrice: "0.358",
      FastGasPrice: "0.638",
      suggestBaseFee: "0.357",
      gasUsedRatio: "0.5,0.6,0.5,0.4,0.5",
    },
  };
}

function ethPriceResponse() {
  return {
    status: "1",
    message: "OK",
    result: {
      ethbtc: "0.0271",
      ethbtc_timestamp: "1781953307",
      ethusd: "3612.24",
      ethusd_timestamp: "1781953307",
    },
  };
}

describe("/gas command", () => {
  const mockCtx = {
    reply: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    clearEtherscanCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ETHERSCAN_API_KEY;
  });

  it("shows Etherscan gas data when API key is set", async () => {
    process.env.ETHERSCAN_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes("gasoracle")
        ? gasOracleResponse()
        : ethPriceResponse();
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    await gasCommand(mockCtx);
    const reply = mockCtx.reply.mock.calls[0][0];

    expect(reply).toContain("Etherscan");
    expect(reply).toContain("Safe:");
    expect(reply).toContain("Standard:");
    expect(reply).toContain("Fast:");
    expect(reply).toContain("Base fee:");
    expect(reply).toContain("Block:");
    expect(reply).toContain("Network load:");
    expect(reply).toContain("ETH");
    // Should show USD when ETH price is available
    expect(reply).toContain("$");
    expect(reply).toContain("ETH:");
  });

  it("falls back to RPC when ETHERSCAN_API_KEY is not set", async () => {
    // No ETHERSCAN_API_KEY set
    await gasCommand(mockCtx);
    const reply = mockCtx.reply.mock.calls[0][0];

    expect(reply).toContain("RPC");
    expect(reply).toContain("Base fee:");
    expect(reply).toContain("gwei");
  });

  it("falls back to RPC when Etherscan API fails", async () => {
    process.env.ETHERSCAN_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("API down"));

    await gasCommand(mockCtx);
    const reply = mockCtx.reply.mock.calls[0][0];

    expect(reply).toContain("RPC");
    expect(reply).toContain("gwei");
  });

  it("shows error message when both Etherscan and RPC fail", async () => {
    process.env.ETHERSCAN_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("API down"));
    // Also make RPC fail
    const fxMock = await import("../src/fx/index.js");
    vi.mocked(fxMock.createPublicClientForUser).mockReturnValue({
      estimateFeesPerGas: vi.fn().mockRejectedValue(new Error("RPC down")),
    } as any);

    await gasCommand(mockCtx);
    const reply = mockCtx.reply.mock.calls[0][0];

    expect(reply).toContain("❌");
    expect(reply).toContain("Couldn't fetch");
  });

  it("shows stale indicator when Etherscan returns cached data", async () => {
    process.env.ETHERSCAN_API_KEY = "test-key";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes("gasoracle")
        ? gasOracleResponse()
        : ethPriceResponse();
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    // First call succeeds
    await gasCommand(mockCtx);
    expect(mockCtx.reply.mock.calls[0][0]).not.toContain("⚠️");
  });
});
