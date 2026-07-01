import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CallbackKeys module tests — Phase 2.
 * Tests the in-memory TTL store for callback payloads.
 */

vi.mock("../src/middleware/logger", () => ({
  botLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  storeCallbackPayload,
  consumeCallbackPayload,
  peekCallbackPayload,
  callbackKeyCount,
} from "../src/core/callbackKeys.js";

describe("callbackKeys", () => {
  describe("storeCallbackPayload", () => {
    it("returns a 10-char hex nonce", () => {
      const nonce = storeCallbackPayload({ action: "test" });
      expect(nonce).toMatch(/^[0-9a-f]{10}$/);
    });

    it("returns unique nonces on successive calls", () => {
      const a = storeCallbackPayload({ action: "a" });
      const b = storeCallbackPayload({ action: "b" });
      expect(a).not.toBe(b);
    });
  });

  describe("consumeCallbackPayload", () => {
    it("retrieves stored payload", () => {
      const nonce = storeCallbackPayload({ action: "ls_step1", market: "wstETH" });
      const payload = consumeCallbackPayload(nonce);
      expect(payload).not.toBeNull();
      expect(payload!.action).toBe("ls_step1");
      expect(payload!.market).toBe("wstETH");
    });

    it("deletes payload after consumption (one-time use)", () => {
      const nonce = storeCallbackPayload({ action: "once" });
      const first = consumeCallbackPayload(nonce);
      expect(first).not.toBeNull();

      const second = consumeCallbackPayload(nonce);
      expect(second).toBeNull();
    });

    it("returns null for unknown nonce", () => {
      const payload = consumeCallbackPayload("aaaaaaaaaa");
      expect(payload).toBeNull();
    });
  });

  describe("peekCallbackPayload", () => {
    it("retrieves without consuming", () => {
      const nonce = storeCallbackPayload({ action: "peek_test" });
      const first = peekCallbackPayload(nonce);
      expect(first).not.toBeNull();
      expect(first!.action).toBe("peek_test");

      // Peek again — should still be there
      const second = peekCallbackPayload(nonce);
      expect(second).not.toBeNull();
      expect(second!.action).toBe("peek_test");

      // Now consume
      const consumed = consumeCallbackPayload(nonce);
      expect(consumed).not.toBeNull();

      // After consume, should be gone
      const afterConsume = peekCallbackPayload(nonce);
      expect(afterConsume).toBeNull();
    });
  });

  describe("callbackKeyCount", () => {
    it("counts active (non-expired) keys", () => {
      const initialCount = callbackKeyCount();
      storeCallbackPayload({ action: "count_test_1" });
      storeCallbackPayload({ action: "count_test_2" });
      const newCount = callbackKeyCount();
      expect(newCount).toBeGreaterThanOrEqual(initialCount + 2);
    });
  });

  describe("TTL expiry", () => {
    it("returns null for expired payloads", () => {
      // We can test this by storing, then manipulating time
      vi.useFakeTimers();
      const nonce = storeCallbackPayload({ action: "ttl_test" });

      // Advance time past TTL (10 minutes = 600s = 600_000ms)
      vi.advanceTimersByTime(601_000);

      const payload = consumeCallbackPayload(nonce);
      expect(payload).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("Complex payloads", () => {
    it("preserves all payload fields", () => {
      const nonce = storeCallbackPayload({
        action: "ls_size_selected",
        market: "WBTC",
        side: "long",
        asset: "BTC",
        leverage: 5,
        collateralSymbol: "fxUSD",
        collateralAddress: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
        collateralDecimals: 18,
        amount: 500,
        sizeLabel: "50%",
      });
      const payload = consumeCallbackPayload(nonce);
      expect(payload).not.toBeNull();
      expect(payload!.market).toBe("WBTC");
      expect(payload!.leverage).toBe(5);
      expect(payload!.amount).toBe(500);
      expect(payload!.sizeLabel).toBe("50%");
    });
  });
});
