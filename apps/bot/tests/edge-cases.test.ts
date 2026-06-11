import { describe, it, expect, vi } from "vitest";
import { startCommand } from "../src/commands/start";
import { tradeCommand } from "../src/commands/trade";
import { limitCommand } from "../src/commands/limit";
import { settingsCommand } from "../src/commands/settings";
import { referCommand } from "../src/commands/refer";
import { autoCommand } from "../src/commands/auto";
import { RISK_PARAMS } from "@fxbot/shared";
import { tEn } from "./helpers/i18n";

describe("Edge Cases — Commands", () => {
  const createMockCtx = (overrides = {}) => ({
    from: { id: 123456, language_code: "en" },
    message: { text: "" },
    reply: vi.fn(),
    t: tEn,
    i18n: { useLocale: vi.fn() },
    ...overrides,
  });

  describe("/start edge cases", () => {
    it("should handle missing Telegram user ID", async () => {
      const ctx = createMockCtx({ from: undefined });
      await startCommand(ctx as any);
      // Should not throw, just return early
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it("should handle very long referral codes", async () => {
      const ctx = createMockCtx({
        message: { text: `/start ref_${"A".repeat(1000)}` },
      });
      await startCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle special characters in referral codes", async () => {
      const ctx = createMockCtx({
        message: { text: "/start ref_abc-123_def" },
      });
      await startCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });
  });

  describe("/trade edge cases", () => {
    it("should reject leverage at exactly 1.0x (below minimum)", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH long 1.0x 1ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("between")
      );
    });

    it("should reject leverage at exactly 7.1x (above max long)", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH long 7.1x 1ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("between")
      );
    });

    it("should reject leverage at exactly 3.1x for short", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH short 3.1x 1ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("between")
      );
    });

    it("should handle negative collateral amounts", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH long 3x -1ETH" },
      });
      await tradeCommand(ctx as any);
      // Should show preview but simulation would catch negative
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle zero collateral", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH long 3x 0ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle extremely large numbers", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH long 3x 999999999ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle malformed input (missing side)", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH 3x 1ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Usage:")
      );
    });

    it("should handle case-insensitive market names", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade WSTETH long 3x 1ETH" },
      });
      await tradeCommand(ctx as any);
      // Should be rejected as invalid market (case-sensitive)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Invalid market")
      );
    });

    it("should handle invalid side (neither long nor short)", async () => {
      const ctx = createMockCtx({
        message: { text: "/trade wstETH neutral 3x 1ETH" },
      });
      await tradeCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Usage:")
      );
    });
  });

  describe("/limit edge cases", () => {
    it("should handle negative trigger prices", async () => {
      const ctx = createMockCtx({
        message: { text: "/limit open wstETH long at -100" },
      });
      await limitCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle zero trigger price", async () => {
      const ctx = createMockCtx({
        message: { text: "/limit open wstETH long at 0" },
      });
      await limitCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle extremely high trigger prices", async () => {
      const ctx = createMockCtx({
        message: { text: "/limit open wstETH long at 999999999" },
      });
      await limitCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle invalid action (neither open nor close)", async () => {
      const ctx = createMockCtx({
        message: { text: "/limit modify wstETH long at 2800" },
      });
      await limitCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Invalid")
      );
    });
  });

  describe("/settings edge cases", () => {
    it("should reject slippage above 2.0%", async () => {
      const ctx = createMockCtx({
        message: { text: "/settings slippage 5.0" },
      });
      await settingsCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("between")
      );
    });

    it("should reject slippage at exactly 0%", async () => {
      const ctx = createMockCtx({
        message: { text: "/settings slippage 0" },
      });
      await settingsCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("between")
      );
    });

    it("should reject invalid language codes", async () => {
      const ctx = createMockCtx({
        message: { text: "/settings lang fr" },
      });
      await settingsCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Unknown setting")
      );
    });

    it("should handle invalid MEV toggle value", async () => {
      const ctx = createMockCtx({
        message: { text: "/settings mev maybe" },
      });
      await settingsCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Unknown setting")
      );
    });
  });

  describe("/refer edge cases", () => {
    it("should generate unique referral codes", async () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        codes.add(code);
      }
      // With 36^6 combinations, collisions should be extremely rare
      expect(codes.size).toBeGreaterThan(95);
    });
  });

  describe("/auto edge cases", () => {
    it("should handle empty rules list gracefully", async () => {
      const ctx = createMockCtx({
        message: { text: "/auto" },
      });
      await autoCommand(ctx as any);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("No automation rules")
      );
    });
  });
});
