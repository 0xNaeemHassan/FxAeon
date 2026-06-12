/**
 * Action-intent token security (core/actionIntent.ts) and the fail-closed
 * target allow-list for earn/borrow routes (fx/earn.ts assertKnownTargets).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ACTION_INTENT_TTL_MS,
  createActionIntent,
  looksLikeActionIntent,
  packAmount,
  unpackAmount,
  verifyActionIntent,
} from "../src/core/actionIntent.js";
import { assertKnownTargets } from "../src/fx/earn.js";
import { ADDRESSES } from "@fxbot/shared";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  delete process.env.INTENT_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("packAmount / unpackAmount", () => {
  it("round-trips amounts at micro precision", () => {
    for (const n of [0.000001, 0.5, 1, 1234.567891, 1_000_000]) {
      expect(unpackAmount(packAmount(n))).toBeCloseTo(n, 6);
    }
  });

  it("uses 0 as the ALL sentinel", () => {
    expect(unpackAmount("0")).toBe(0);
  });
});

describe("createActionIntent / verifyActionIntent", () => {
  it("round-trips kind and params and stays within Telegram's 64-byte limit", () => {
    const token = createActionIntent("rp", { p1: "1", p2: (123456).toString(36), p3: packAmount(9999.99) });
    expect(looksLikeActionIntent(token)).toBe(true);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    const verdict = verifyActionIntent(token);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.intent.kind).toBe("rp");
      expect(verdict.intent.p1).toBe("1");
      expect(parseInt(verdict.intent.p2, 36)).toBe(123456);
      expect(unpackAmount(verdict.intent.p3)).toBeCloseTo(9999.99, 6);
    }
  });

  it("rejects tampered tokens (any field change breaks the signature)", () => {
    const token = createActionIntent("sd", { p1: "f", p2: packAmount(100) });
    const parts = token.split("_");
    // Tamper with the amount field.
    parts[3] = packAmount(1_000_000);
    const verdict = verifyActionIntent(parts.join("_"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("tampered");
  });

  it("rejects expired tokens after the TTL", () => {
    const token = createActionIntent("sc", {});
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + ACTION_INTENT_TTL_MS + 60_000);
    const verdict = verifyActionIntent(token);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("expired");
  });

  it("rejects garbage and truncated tokens", () => {
    for (const bad of ["a1_", "a1_sd_x", "nonsense", createActionIntent("sd", {}).slice(0, -2)]) {
      expect(verifyActionIntent(bad).ok).toBe(false);
    }
  });
});

describe("assertKnownTargets (fail-closed route guard)", () => {
  const tx = (to: string) => ({ to, data: "0x" as const, value: 0n });

  it("passes routes that only touch verified f(x) contracts", () => {
    const txs = assertKnownTargets(
      [tx(ADDRESSES.FXUSD), tx(ADDRESSES.ROUTER), tx(ADDRESSES.FX_MINT_ROUTER), tx(ADDRESSES.FXSAVE)],
      "test"
    );
    expect(txs).toHaveLength(4);
  });

  it("is case-insensitive on addresses", () => {
    expect(assertKnownTargets([tx(ADDRESSES.ROUTER.toLowerCase())], "test")).toHaveLength(1);
  });

  it("throws on any unknown target — the route is rejected before signing", () => {
    expect(() =>
      assertKnownTargets([tx(ADDRESSES.ROUTER), tx("0x000000000000000000000000000000000000dEaD")], "test")
    ).toThrow(/unexpected contract/i);
  });
});
