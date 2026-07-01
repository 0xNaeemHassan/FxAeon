/**
 * Natural-language intent parser — Phase 5 (Masterplan).
 *
 * Parses free-text messages like:
 *   "go long 500 fxusd on btc at 5x"
 *   "short eth 0.5 wsteth 3x"
 *   "close my btc long"
 *   "deposit 100 usdc into fxsave"
 *   "check my positions"
 *
 * Strategy: deterministic regex-first parser that matches the fx-sdk-agent
 * JSON Schema tool parameters. No LLM required — this keeps latency <5ms
 * and avoids privacy concerns with sending user messages to external APIs.
 *
 * The parser produces a `ParsedIntent` which the caller maps to the
 * same Step 5 signed preview that a button tap would produce.
 */
import { MARKETS, RISK_PARAMS, type Market } from "@fxaeon/shared";
import { botLogger } from "../middleware/logger.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type IntentAction =
  | "open_long"
  | "open_short"
  | "close_position"
  | "adjust_leverage"
  | "check_positions"
  | "check_portfolio"
  | "deposit"
  | "withdraw"
  | "fxsave_deposit"
  | "fxsave_withdraw"
  | "check_price"
  | "help"
  | "unknown";

export interface ParsedIntent {
  action: IntentAction;
  /** Market for trade intents (ETH or BTC) */
  market?: Market;
  /** Side for trade intents */
  side?: "long" | "short";
  /** Leverage multiplier */
  leverage?: number;
  /** Amount in human-readable units */
  amount?: number;
  /** Collateral/token symbol */
  token?: string;
  /** Raw input text */
  raw: string;
  /** Confidence: "high" = all fields extracted, "medium" = partial, "low" = fallback */
  confidence: "high" | "medium" | "low";
}

// ── Market Resolution ───────────────────────────────────────────────────────

const MARKET_ALIASES: Record<string, Market> = {
  btc: "BTC",
  bitcoin: "BTC",
  wbtc: "BTC",
  eth: "ETH",
  ethereum: "ETH",
  wsteth: "ETH",
  steth: "ETH",
  weth: "ETH",
};

function resolveMarket(word: string): Market | undefined {
  return MARKET_ALIASES[word.toLowerCase()] ?? (MARKETS.includes(word.toUpperCase() as Market) ? word.toUpperCase() as Market : undefined);
}

// ── Token Resolution ────────────────────────────────────────────────────────

const TOKEN_ALIASES: Record<string, string> = {
  fxusd: "fxUSD",
  usdc: "USDC",
  usdt: "USDT",
  wsteth: "wstETH",
  steth: "stETH",
  weth: "WETH",
  eth: "ETH",
  wbtc: "WBTC",
};

function resolveToken(word: string): string | undefined {
  return TOKEN_ALIASES[word.toLowerCase()];
}

// ── Number Extraction ───────────────────────────────────────────────────────

/** Extract a number from a word, handling $500, 500usd, 0.5, etc. */
function extractNumber(word: string): number | undefined {
  const cleaned = word.replace(/^\$/, "").replace(/,/g, "").replace(/usd$/i, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Extract leverage from text like "5x", "at 5x", "5×", "leverage 5" */
function extractLeverage(word: string): number | undefined {
  const m = word.match(/^(\d+(?:\.\d+)?)[x×]$/i);
  if (m) return parseFloat(m[1]);
  return undefined;
}

// ── Intent Parsing ──────────────────────────────────────────────────────────

/** Keywords that signal a long intent */
const LONG_KEYWORDS = new Set(["long", "buy", "bull", "bullish"]);
/** Keywords that signal a short intent */
const SHORT_KEYWORDS = new Set(["short", "sell", "bear", "bearish", "put"]);
/** Keywords that signal close */
const CLOSE_KEYWORDS = new Set(["close", "exit", "sell", "liquidate"]);
/** Keywords that signal positions check */
const POSITION_KEYWORDS = new Set(["positions", "portfolio", "holdings", "balance", "pnl"]);
/** Keywords that signal price check */
const PRICE_KEYWORDS = new Set(["price", "prices", "quote", "chart"]);
/** Keywords that signal help */
const HELP_KEYWORDS = new Set(["help", "commands", "menu", "start"]);
/** Keywords that signal fxSAVE */
const SAVE_KEYWORDS = new Set(["save", "earn", "fxsave", "stake", "staking", "compound", "claim"]);

/**
 * Parse a natural-language message into a structured intent.
 *
 * The parser scans tokens left-to-right, building up the intent from
 * recognized patterns. It doesn't use an LLM — pure regex + keyword matching.
 */
export function parseIntent(text: string): ParsedIntent {
  const raw = text.trim();
  const words = raw
    .toLowerCase()
    .replace(/[,!?.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return { action: "unknown", raw, confidence: "low" };
  }

  // ── Help ────────────────────────────────────────────────────────────────
  if (words.some((w) => HELP_KEYWORDS.has(w)) && words.length <= 2) {
    return { action: "help", raw, confidence: "high" };
  }

  // ── Price check ─────────────────────────────────────────────────────────
  if (words.some((w) => PRICE_KEYWORDS.has(w))) {
    const market = words.map(resolveMarket).find(Boolean);
    return {
      action: "check_price",
      market,
      raw,
      confidence: market ? "high" : "medium",
    };
  }

  // ── Portfolio / positions ───────────────────────────────────────────────
  if (words.some((w) => POSITION_KEYWORDS.has(w))) {
    return {
      action: words.includes("portfolio") ? "check_portfolio" : "check_positions",
      raw,
      confidence: "high",
    };
  }

  // ── fxSAVE flows ───────────────────────────────────────────────────────
  if (words.some((w) => SAVE_KEYWORDS.has(w))) {
    const isWithdraw = words.some((w) => ["withdraw", "unstake", "redeem"].includes(w));
    const amount = words.map(extractNumber).find(Boolean);
    const token = words.map(resolveToken).find(Boolean);
    return {
      action: isWithdraw ? "fxsave_withdraw" : "fxsave_deposit",
      amount,
      token,
      raw,
      confidence: amount ? "high" : "medium",
    };
  }

  // ── Deposit / Withdraw ────────────────────────────────────────────────
  if (words.includes("deposit") && !words.some((w) => SAVE_KEYWORDS.has(w))) {
    const amount = words.map(extractNumber).find(Boolean);
    const token = words.map(resolveToken).find(Boolean);
    return { action: "deposit", amount, token, raw, confidence: amount ? "high" : "medium" };
  }
  if (words.includes("withdraw") && !words.some((w) => SAVE_KEYWORDS.has(w))) {
    const amount = words.map(extractNumber).find(Boolean);
    const token = words.map(resolveToken).find(Boolean);
    return { action: "withdraw", amount, token, raw, confidence: amount ? "high" : "medium" };
  }

  // ── Close position ────────────────────────────────────────────────────
  if (words.some((w) => CLOSE_KEYWORDS.has(w))) {
    const market = words.map(resolveMarket).find(Boolean);
    const side: "long" | "short" | undefined = words.some((w) => LONG_KEYWORDS.has(w))
      ? "long"
      : words.some((w) => SHORT_KEYWORDS.has(w))
        ? "short"
        : undefined;

    // "close" alone without other trade context = close intent
    if (words.includes("close") || words.includes("exit")) {
      return {
        action: "close_position",
        market,
        side,
        raw,
        confidence: market && side ? "high" : "medium",
      };
    }
  }

  // ── Open position (long / short) ──────────────────────────────────────
  const hasLong = words.some((w) => LONG_KEYWORDS.has(w));
  const hasShort = words.some((w) => SHORT_KEYWORDS.has(w));

  if (hasLong || hasShort) {
    const side: "long" | "short" = hasLong ? "long" : "short";
    const market = words.map(resolveMarket).find(Boolean);
    const leverage = words.map(extractLeverage).find(Boolean);
    const amount = words.map(extractNumber).find(Boolean);
    const token = words.map(resolveToken).find(Boolean);

    // Validate leverage
    const maxLev = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
    const validLeverage =
      leverage && leverage >= RISK_PARAMS.MIN_LEVERAGE && leverage <= maxLev
        ? leverage
        : undefined;

    const action: IntentAction = side === "long" ? "open_long" : "open_short";
    const filled = [market, validLeverage, amount].filter(Boolean).length;
    const confidence = filled >= 2 ? "high" : filled >= 1 ? "medium" : "low";

    return {
      action,
      market,
      side,
      leverage: validLeverage,
      amount,
      token,
      raw,
      confidence: confidence as "high" | "medium" | "low",
    };
  }

  // ── Adjust leverage ───────────────────────────────────────────────────
  if (words.some((w) => ["adjust", "change", "set"].includes(w)) && words.some((w) => ["leverage", "lev"].includes(w))) {
    const leverage = words.map(extractLeverage).find(Boolean);
    const market = words.map(resolveMarket).find(Boolean);
    return {
      action: "adjust_leverage",
      market,
      leverage,
      raw,
      confidence: leverage ? "high" : "medium",
    };
  }

  // ── Shorthand: "longBTC 500 5x" / "shortETH 0.5 3x" ─────────────────
  const shorthandMatch = words[0]?.match(/^(long|short)(btc|eth|bitcoin|ethereum)$/);
  if (shorthandMatch) {
    const side = shorthandMatch[1] as "long" | "short";
    const market = resolveMarket(shorthandMatch[2])!;
    const leverage = words.map(extractLeverage).find(Boolean);
    const amount = words.slice(1).map(extractNumber).find(Boolean);
    const token = words.slice(1).map(resolveToken).find(Boolean);

    return {
      action: side === "long" ? "open_long" : "open_short",
      market,
      side,
      leverage,
      amount,
      token,
      raw,
      confidence: amount ? "high" : "medium",
    };
  }

  return { action: "unknown", raw, confidence: "low" };
}

/**
 * Check if a text message looks like it could be a natural-language trade intent.
 * Used as a gate before running the full parser — avoids processing every message.
 */
export function looksLikeNaturalIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Skip if it starts with "/" (it's a command)
  if (lower.startsWith("/")) return false;
  // Skip very short messages
  if (lower.length < 3) return false;

  // Check for any known keywords
  const allKeywords = [
    ...LONG_KEYWORDS,
    ...SHORT_KEYWORDS,
    ...CLOSE_KEYWORDS,
    ...POSITION_KEYWORDS,
    ...PRICE_KEYWORDS,
    ...SAVE_KEYWORDS,
    "deposit",
    "withdraw",
    "adjust",
    "leverage",
  ];

  return allKeywords.some((kw) => lower.includes(kw));
}

/**
 * Map a parsed intent to the trade parameters needed by buildPreview.
 * Returns null if the intent doesn't have enough info for a trade preview.
 */
export function intentToTradeParams(
  intent: ParsedIntent
): { market: Market; side: "long" | "short"; leverage: number; amount: number } | null {
  if (
    (intent.action !== "open_long" && intent.action !== "open_short") ||
    !intent.market ||
    !intent.amount
  ) {
    return null;
  }

  const side = intent.side ?? (intent.action === "open_long" ? "long" : "short");
  const leverage = intent.leverage ?? 3; // Default leverage

  return {
    market: intent.market,
    side,
    leverage,
    amount: intent.amount,
  };
}
