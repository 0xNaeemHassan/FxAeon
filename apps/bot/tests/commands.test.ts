import { describe, it, expect, beforeEach, vi } from "vitest";
import { startCommand } from "../src/commands/start";
import { tradeCommand } from "../src/commands/trade";
import { portfolioCommand } from "../src/commands/portfolio";
import { settingsCommand } from "../src/commands/settings";
import { helpCommand } from "../src/commands/help";
import { RISK_PARAMS, ADDRESSES } from "@fxbot/shared";
import { tEn } from "./helpers/i18n";

describe("Commands", () => {
  const mockCtx = {
    from: { id: 123456, language_code: "en" },
    message: { text: "" },
    reply: vi.fn(),
    t: tEn,
    i18n: { useLocale: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/start", () => {
    it("should show welcome for new users", async () => {
      mockCtx.message.text = "/start";
      await startCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Welcome to fxBot"),
        expect.objectContaining({ reply_markup: expect.anything() })
      );
    });

    it("should handle referral codes", async () => {
      mockCtx.message.text = "/start ref_ABCD1234";
      await startCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("ABCD1234"),
        expect.objectContaining({ reply_markup: expect.anything() })
      );
    });
  });

  describe("/trade", () => {
    it("should show usage for invalid args", async () => {
      mockCtx.message.text = "/trade";
      await tradeCommand(mockCtx);
      // W-17: bare /trade now also attaches the inline market ladder.
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Usage:"),
        expect.objectContaining({ reply_markup: expect.anything() })
      );
    });

    it("should validate leverage limits", async () => {
      mockCtx.message.text = "/trade wstETH long 10x 1ETH";
      await tradeCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`between ${RISK_PARAMS.MIN_LEVERAGE}x and ${RISK_PARAMS.MAX_LEVERAGE_LONG}x`)
      );
    });

    it("should validate market", async () => {
      mockCtx.message.text = "/trade INVALID long 3x 1ETH";
      await tradeCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Invalid market")
      );
    });
  });

  describe("/settings", () => {
    it("should show current settings", async () => {
      mockCtx.message.text = "/settings";
      await settingsCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Settings")
      );
    });

    it("should update language", async () => {
      mockCtx.message.text = "/settings lang zh-CN";
      await settingsCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("zh-CN")
      );
    });

    it("should validate slippage bounds", async () => {
      mockCtx.message.text = "/settings slippage 5.0";
      await settingsCommand(mockCtx);
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("must be between")
      );
    });
  });

  describe("/help", () => {
    it("should list all commands", async () => {
      await helpCommand(mockCtx);
      const call = mockCtx.reply.mock.calls[0][0];
      expect(call).toContain("/trade");
      expect(call).toContain("/limit");
      expect(call).toContain("/portfolio");
      expect(call).toContain("/settings");
      expect(call).toContain("/security");
      expect(call).toContain("/auto");
      expect(call).toContain("/refer");
    });
  });
});
