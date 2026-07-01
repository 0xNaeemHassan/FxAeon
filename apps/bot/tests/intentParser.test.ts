import { describe, it, expect } from "vitest";

/**
 * Natural-language intent parser tests — Phase 5.
 * Tests the regex-based NL parser without any LLM dependency.
 */

// Direct import of pure functions (no mocks needed)
import {
  parseIntent,
  looksLikeNaturalIntent,
  intentToTradeParams,
} from "../src/agent/intentParser.js";

describe("parseIntent", () => {
  describe("open long", () => {
    it("parses 'go long 500 fxusd on btc at 5x'", () => {
      const result = parseIntent("go long 500 fxusd on btc at 5x");
      expect(result.action).toBe("open_long");
      expect(result.market).toBe("BTC");
      expect(result.side).toBe("long");
      expect(result.leverage).toBe(5);
      expect(result.amount).toBe(500);
      expect(result.token).toBe("fxUSD");
      expect(result.confidence).toBe("high");
    });

    it("parses 'long eth 0.5 wsteth 3x'", () => {
      const result = parseIntent("long eth 0.5 wsteth 3x");
      expect(result.action).toBe("open_long");
      expect(result.market).toBe("ETH");
      expect(result.amount).toBe(0.5);
      expect(result.leverage).toBe(3);
    });

    it("parses 'buy btc 1000 7x'", () => {
      const result = parseIntent("buy btc 1000 7x");
      expect(result.action).toBe("open_long");
      expect(result.market).toBe("BTC");
      expect(result.amount).toBe(1000);
      expect(result.leverage).toBe(7);
    });

    it("parses 'bull eth'", () => {
      const result = parseIntent("bull eth");
      expect(result.action).toBe("open_long");
      expect(result.market).toBe("ETH");
    });
  });

  describe("open short", () => {
    it("parses 'short eth 0.5 wsteth 3x'", () => {
      const result = parseIntent("short eth 0.5 wsteth 3x");
      expect(result.action).toBe("open_short");
      expect(result.market).toBe("ETH");
      expect(result.leverage).toBe(3);
      expect(result.amount).toBe(0.5);
    });

    it("parses 'bear btc 2x'", () => {
      const result = parseIntent("bear btc 2x");
      expect(result.action).toBe("open_short");
      expect(result.market).toBe("BTC");
      expect(result.leverage).toBe(2);
    });

    it("caps short leverage at MAX_LEVERAGE_SHORT", () => {
      // MAX_LEVERAGE_SHORT = 3, so 5x should be rejected
      const result = parseIntent("short btc 100 5x");
      expect(result.action).toBe("open_short");
      expect(result.leverage).toBeUndefined(); // 5x exceeds short max
    });
  });

  describe("shorthand", () => {
    it("parses 'longbtc 500 5x'", () => {
      const result = parseIntent("longbtc 500 5x");
      expect(result.action).toBe("open_long");
      expect(result.market).toBe("BTC");
      expect(result.amount).toBe(500);
      expect(result.leverage).toBe(5);
    });

    it("parses 'shorteth 0.5 3x'", () => {
      const result = parseIntent("shorteth 0.5 3x");
      expect(result.action).toBe("open_short");
      expect(result.market).toBe("ETH");
      expect(result.amount).toBe(0.5);
    });
  });

  describe("close position", () => {
    it("parses 'close my btc long'", () => {
      const result = parseIntent("close my btc long");
      expect(result.action).toBe("close_position");
      expect(result.market).toBe("BTC");
      expect(result.side).toBe("long");
    });

    it("parses 'exit eth short'", () => {
      const result = parseIntent("exit eth short");
      expect(result.action).toBe("close_position");
      expect(result.market).toBe("ETH");
      expect(result.side).toBe("short");
    });

    it("parses 'close all'", () => {
      const result = parseIntent("close all");
      expect(result.action).toBe("close_position");
      expect(result.confidence).toBe("medium"); // no market specified
    });
  });

  describe("portfolio / positions", () => {
    it("parses 'check my positions'", () => {
      const result = parseIntent("check my positions");
      expect(result.action).toBe("check_positions");
    });

    it("parses 'portfolio'", () => {
      const result = parseIntent("portfolio");
      expect(result.action).toBe("check_portfolio");
    });

    it("parses 'show pnl'", () => {
      const result = parseIntent("show pnl");
      expect(result.action).toBe("check_positions");
    });
  });

  describe("price check", () => {
    it("parses 'price btc'", () => {
      const result = parseIntent("price btc");
      expect(result.action).toBe("check_price");
      expect(result.market).toBe("BTC");
    });

    it("parses 'what is the price of ethereum'", () => {
      const result = parseIntent("what is the price of ethereum");
      expect(result.action).toBe("check_price");
      expect(result.market).toBe("ETH");
    });
  });

  describe("fxSAVE", () => {
    it("parses 'deposit 100 usdc into fxsave'", () => {
      const result = parseIntent("deposit 100 usdc into fxsave");
      expect(result.action).toBe("fxsave_deposit");
      expect(result.amount).toBe(100);
      expect(result.token).toBe("USDC");
    });

    it("parses 'earn'", () => {
      const result = parseIntent("earn");
      expect(result.action).toBe("fxsave_deposit");
    });

    it("parses 'withdraw from save'", () => {
      const result = parseIntent("withdraw from save");
      expect(result.action).toBe("fxsave_withdraw");
    });
  });

  describe("help", () => {
    it("parses 'help'", () => {
      const result = parseIntent("help");
      expect(result.action).toBe("help");
      expect(result.confidence).toBe("high");
    });
  });

  describe("unknown", () => {
    it("returns unknown for gibberish", () => {
      const result = parseIntent("asdfghjkl");
      expect(result.action).toBe("unknown");
      expect(result.confidence).toBe("low");
    });

    it("returns unknown for empty string", () => {
      const result = parseIntent("");
      expect(result.action).toBe("unknown");
    });
  });
});

describe("looksLikeNaturalIntent", () => {
  it("returns false for commands", () => {
    expect(looksLikeNaturalIntent("/trade")).toBe(false);
  });

  it("returns false for short messages", () => {
    expect(looksLikeNaturalIntent("hi")).toBe(false);
  });

  it("returns true for trade keywords", () => {
    expect(looksLikeNaturalIntent("go long on btc")).toBe(true);
    expect(looksLikeNaturalIntent("short eth now")).toBe(true);
    expect(looksLikeNaturalIntent("check my positions")).toBe(true);
  });
});

describe("intentToTradeParams", () => {
  it("extracts trade params from a complete intent", () => {
    const intent = parseIntent("long btc 500 fxusd 5x");
    const params = intentToTradeParams(intent);
    expect(params).not.toBeNull();
    expect(params!.market).toBe("BTC");
    expect(params!.side).toBe("long");
    expect(params!.leverage).toBe(5);
    expect(params!.amount).toBe(500);
  });

  it("returns null for non-trade intents", () => {
    const intent = parseIntent("check my positions");
    expect(intentToTradeParams(intent)).toBeNull();
  });

  it("returns null when amount is missing", () => {
    const intent = parseIntent("long btc");
    expect(intentToTradeParams(intent)).toBeNull();
  });

  it("defaults leverage to 3 when not specified", () => {
    const intent = parseIntent("long btc 500");
    const params = intentToTradeParams(intent);
    expect(params).not.toBeNull();
    expect(params!.leverage).toBe(3);
  });
});
