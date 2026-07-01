import { describe, it, expect, vi } from "vitest";

/**
 * Trade Intent v2 tests — Phase 3.
 * Tests v2 token creation, verification, tamper detection.
 */

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FEE_COLLECTOR: "0xea24f6a870b57455a83387704d7d2a12e3463d84",
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  },
  MARKETS: ["wstETH", "WBTC"],
  RISK_PARAMS: {
    MAX_LEVERAGE_LONG: 7,
    MAX_LEVERAGE_SHORT: 3,
    MIN_LEVERAGE: 1.1,
  },
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    feeLedger: { create: vi.fn() },
    botState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Set a deterministic signing key
process.env.INTENT_SECRET = "test-secret-for-trade-intents";

import {
  createTradeIntentV2,
  verifyTradeIntentV2,
  looksLikeTradeIntentV2,
} from "../src/core/tradeIntent.js";

describe("createTradeIntentV2", () => {
  it("creates a v2 token string", () => {
    const token = createTradeIntentV2({
      market: "wstETH",
      side: "long",
      leverage: 5,
      amount: 0.5,
      kind: "open_long",
      notionalUsd: 1700,
    });
    expect(token).toMatch(/^t2_/);
    expect(typeof token).toBe("string");
  });

  it("looksLikeTradeIntentV2 identifies v2 tokens", () => {
    const token = createTradeIntentV2({
      market: "WBTC",
      side: "short",
      leverage: 3,
      amount: 0.01,
      kind: "open_short",
      notionalUsd: 1030,
    });
    expect(looksLikeTradeIntentV2(token)).toBe(true);
    expect(looksLikeTradeIntentV2("t1_something")).toBe(false);
    expect(looksLikeTradeIntentV2(undefined)).toBe(false);
  });
});

describe("verifyTradeIntentV2", () => {
  it("verifies a valid token", () => {
    const token = createTradeIntentV2({
      market: "wstETH",
      side: "long",
      leverage: 5,
      amount: 1.5,
      kind: "open_long",
      notionalUsd: 5100,
    });
    const result = verifyTradeIntentV2(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.market).toBe("wstETH");
      expect(result.intent.side).toBe("long");
      expect(result.intent.leverage).toBe(5);
      expect(result.intent.amount).toBeCloseTo(1.5, 4);
      expect(result.intent.kind).toBe("open_long");
      expect(result.intent.notionalUsd).toBeCloseTo(5100, 0);
    }
  });

  it("detects tampered tokens", () => {
    const token = createTradeIntentV2({
      market: "WBTC",
      side: "short",
      leverage: 2,
      amount: 0.1,
      kind: "open_short",
      notionalUsd: 10300,
    });
    // Tamper with the leverage field
    const parts = token.split("_");
    parts[3] = "70"; // change leverage from 20 to 70
    const tampered = parts.join("_");
    const result = verifyTradeIntentV2(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("tampered");
    }
  });

  it("rejects malformed tokens", () => {
    expect(verifyTradeIntentV2("t2_garbage").ok).toBe(false);
    expect(verifyTradeIntentV2("t1_0_l_50_500000_999_abc_sig").ok).toBe(false);
    expect(verifyTradeIntentV2("").ok).toBe(false);
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    const token = createTradeIntentV2({
      market: "wstETH",
      side: "long",
      leverage: 3,
      amount: 1,
      kind: "open_long",
      notionalUsd: 3400,
    });
    // Advance past TTL
    vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes
    const result = verifyTradeIntentV2(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("expired");
    }
    vi.useRealTimers();
  });

  it("preserves all intent fields through roundtrip", () => {
    const params = {
      market: "WBTC" as const,
      side: "short" as const,
      leverage: 2.5,
      amount: 0.05,
      kind: "close_short" as const,
      notionalUsd: 5150,
    };
    const token = createTradeIntentV2(params);
    const result = verifyTradeIntentV2(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.market).toBe("WBTC");
      expect(result.intent.side).toBe("short");
      expect(result.intent.leverage).toBe(2.5);
      expect(result.intent.amount).toBeCloseTo(0.05, 4);
      expect(result.intent.kind).toBe("close_short");
      expect(result.intent.notionalUsd).toBeCloseTo(5150, 0);
      expect(result.intent.nonce).toMatch(/^[0-9a-f]{10}$/);
    }
  });
});
