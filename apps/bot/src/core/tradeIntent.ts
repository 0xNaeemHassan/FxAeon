/**
 * Signed trade intents (W-17).
 *
 * A trade intent captures the parameters of a proposed position open
 * (market/side/leverage/amount) in a compact, HMAC-signed, short-TTL token
 * that fits BOTH a Telegram callback_data slot (≤64 bytes) and a /start deep
 * link payload (≤64 chars, charset [A-Za-z0-9_-]).
 *
 * Format:  t1_<marketIdx>_<l|s>_<leverage*10>_<amount*1e6>_<expMinute>_<nonce>_<sig>
 *
 * - The signature covers every field, so params can't be tampered with after
 *   the bot rendered a preview (callback_data and deep links are both
 *   client-controlled surfaces).
 * - The token carries NO user identity: execution always resolves the wallet
 *   of the Telegram user who pressed the button, never one named in the link.
 * - TTL keeps shared deep links from being replayed days later at very
 *   different prices.
 * - The nonce doubles as the executor idempotency key suffix, so double-taps
 *   on Confirm dedupe inside executeRoute instead of broadcasting twice.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MARKETS, type Market } from "@fxaeon/shared";

export interface TradeIntent {
  market: Market;
  side: "long" | "short";
  leverage: number;
  /** Collateral amount in human units of the market's collateral token. */
  amount: number;
  nonce: string;
  expiresAt: number;
}

export type VerifyIntentResult =
  | { ok: true; intent: TradeIntent }
  | { ok: false; reason: "malformed" | "tampered" | "expired" };

const VERSION = "t1";
export const INTENT_TTL_MS = 10 * 60 * 1000;

function signingKey(): Buffer {
  const seed = process.env.INTENT_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!seed) {
    throw new Error(
      "tradeIntent: set INTENT_SECRET or TELEGRAM_BOT_TOKEN — refusing to sign with an empty key"
    );
  }
  // Domain-separate from the raw bot token.
  return createHmac("sha256", seed).update("fxaeon-trade-intent-v1").digest();
}

function sign(body: string): string {
  // 80-bit truncated HMAC: ample for a 10-minute online-only token, and short
  // enough to keep the whole thing under Telegram's 64-char start payload cap.
  return createHmac("sha256", signingKey()).update(body).digest("hex").slice(0, 20);
}

export function createTradeIntent(
  params: { market: Market; side: "long" | "short"; leverage: number; amount: number },
  ttlMs: number = INTENT_TTL_MS
): string {
  const marketIdx = (MARKETS as readonly string[]).indexOf(params.market);
  if (marketIdx < 0) throw new Error(`tradeIntent: unknown market ${params.market}`);
  if (!Number.isFinite(params.leverage) || params.leverage <= 0)
    throw new Error("tradeIntent: invalid leverage");
  if (!Number.isFinite(params.amount) || params.amount <= 0)
    throw new Error("tradeIntent: invalid amount");

  const expMinute = Math.ceil((Date.now() + ttlMs) / 60_000);
  const nonce = randomBytes(5).toString("hex"); // 10 chars, CSPRNG
  const body = [
    VERSION,
    marketIdx,
    params.side === "long" ? "l" : "s",
    Math.round(params.leverage * 10),
    Math.round(params.amount * 1e6),
    expMinute,
    nonce,
  ].join("_");
  return `${body}_${sign(body)}`;
}

export function looksLikeTradeIntent(token: string | undefined): token is string {
  return typeof token === "string" && token.startsWith(`${VERSION}_`);
}

export function verifyTradeIntent(token: string): VerifyIntentResult {
  const parts = token.split("_");
  if (parts.length !== 8 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };

  const body = parts.slice(0, 7).join("_");
  const givenSig = Buffer.from(parts[7]);
  const expectSig = Buffer.from(sign(body));
  if (givenSig.length !== expectSig.length || !timingSafeEqual(givenSig, expectSig)) {
    return { ok: false, reason: "tampered" };
  }

  const [, marketIdxS, sideCode, lev10S, amtMicroS, expMinuteS, nonce] = parts;
  const market = MARKETS[Number(marketIdxS)];
  const leverage = Number(lev10S) / 10;
  const amount = Number(amtMicroS) / 1e6;
  const expiresAt = Number(expMinuteS) * 60_000;
  if (
    !market ||
    (sideCode !== "l" && sideCode !== "s") ||
    !Number.isFinite(leverage) ||
    leverage <= 0 ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(expiresAt)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() > expiresAt) return { ok: false, reason: "expired" };

  return {
    ok: true,
    intent: {
      market,
      side: sideCode === "l" ? "long" : "short",
      leverage,
      amount,
      nonce,
      expiresAt,
    },
  };
}
