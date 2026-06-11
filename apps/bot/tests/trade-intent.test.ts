import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import {
  createTradeIntent,
  verifyTradeIntent,
  looksLikeTradeIntent,
  INTENT_TTL_MS,
} from "../src/core/tradeIntent";

beforeAll(() => {
  process.env.INTENT_SECRET = "test-intent-secret";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tradeIntent (W-17)", () => {
  const params = { market: "wstETH" as const, side: "long" as const, leverage: 3, amount: 0.5 };

  it("round-trips sign → verify", () => {
    const token = createTradeIntent(params);
    const verdict = verifyTradeIntent(token);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.intent.market).toBe("wstETH");
      expect(verdict.intent.side).toBe("long");
      expect(verdict.intent.leverage).toBe(3);
      expect(verdict.intent.amount).toBe(0.5);
      expect(verdict.intent.nonce).toMatch(/^[0-9a-f]{10}$/);
    }
  });

  it("fits Telegram limits: ≤64 chars, deep-link-safe charset", () => {
    const token = createTradeIntent({ market: "WBTC", side: "short", leverage: 2.5, amount: 0.005 });
    expect(token.length).toBeLessThanOrEqual(64);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // confirm callback_data prefix still fits the 64-BYTE callback limit
    expect(Buffer.byteLength(`tc_${token}`)).toBeLessThanOrEqual(64);
  });

  it("rejects tampered params", () => {
    const token = createTradeIntent(params);
    const parts = token.split("_");
    parts[3] = "70"; // 3x → 7x
    const verdict = verifyTradeIntent(parts.join("_"));
    expect(verdict).toEqual({ ok: false, reason: "tampered" });
  });

  it("rejects a forged signature", () => {
    const token = createTradeIntent(params);
    const forged = token.slice(0, -20) + "0".repeat(20);
    expect(verifyTradeIntent(forged)).toEqual({ ok: false, reason: "tampered" });
  });

  it("rejects expired tokens", () => {
    const token = createTradeIntent(params);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + INTENT_TTL_MS + 2 * 60_000);
    expect(verifyTradeIntent(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens", () => {
    expect(verifyTradeIntent("t1_garbage").ok).toBe(false);
    expect(verifyTradeIntent("").ok).toBe(false);
    expect(verifyTradeIntent("v9_0_l_30_500000_1_aa_bb").ok).toBe(false);
  });

  it("different intents get different nonces (idempotency keys)", () => {
    const a = verifyTradeIntent(createTradeIntent(params));
    const b = verifyTradeIntent(createTradeIntent(params));
    expect(a.ok && b.ok && a.intent.nonce !== b.intent.nonce).toBe(true);
  });

  it("looksLikeTradeIntent discriminates payload types", () => {
    expect(looksLikeTradeIntent(createTradeIntent(params))).toBe(true);
    expect(looksLikeTradeIntent("ref_ABCD1234")).toBe(false);
    expect(looksLikeTradeIntent(undefined)).toBe(false);
  });

  it("refuses to sign without a secret", () => {
    const intentSecret = process.env.INTENT_SECRET;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.INTENT_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => createTradeIntent(params)).toThrow(/secret|TOKEN/i);
    process.env.INTENT_SECRET = intentSecret;
    if (botToken) process.env.TELEGRAM_BOT_TOKEN = botToken;
  });
});
