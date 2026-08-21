/**
 * Signed trade intents (W-17).
 *
 * A trade intent captures the parameters of a proposed position open
 * (market/side/leverage/amount) in a compact, HMAC-signed, short-TTL token
 * that fits BOTH a Telegram callback_data slot (≤64 bytes) and a /start deep
 * link payload (≤64 chars, charset [A-Za-z0-9_-]).
 *
 * Format:  t3_<marketIdx>_<l|s>_<leverage*10>_<exactAmount>_<expMinute36>_<nonce>_<sig>
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
import { canonicalActionAmount, packAmount, unpackAmount } from "./actionIntent.js";

export interface TradeIntent {
  market: Market;
  side: "long" | "short";
  leverage: number;
  /** Collateral amount in human units of the market's collateral token. */
  amount: string;
  nonce: string;
  expiresAt: number;
}

export type VerifyIntentResult =
  | { ok: true; intent: TradeIntent }
  | { ok: false; reason: "malformed" | "tampered" | "expired" };

const VERSION = "t3";
export const INTENT_TTL_MS = 10 * 60 * 1000;

function signingKey(): Buffer {
  const seed = process.env.INTENT_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!seed) {
    throw new Error(
      "tradeIntent: set INTENT_SECRET or TELEGRAM_BOT_TOKEN — refusing to sign with an empty key"
    );
  }
  // Domain-separate from the raw bot token.
  return createHmac("sha256", seed).update("fxaeon-trade-intent-v3").digest();
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  do {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  } while (value > 0n);
  return out.padStart(14, "0");
}

function sign(body: string): string {
  // 80-bit truncated HMAC: ample for a 10-minute online-only token, and short
  // enough to keep the whole thing under Telegram's 64-char start payload cap.
  return base62(createHmac("sha256", signingKey()).update(body).digest().subarray(0, 10));
}

export function createTradeIntent(
  params: { market: Market; side: "long" | "short"; leverage: number; amount: string | number },
  ttlMs: number = INTENT_TTL_MS
): string {
  const marketIdx = (MARKETS as readonly string[]).indexOf(params.market);
  if (marketIdx < 0) throw new Error(`tradeIntent: unknown market ${params.market}`);
  const lev10 = params.leverage * 10;
  if (!Number.isFinite(params.leverage) || params.leverage <= 0 || !Number.isInteger(lev10))
    throw new Error("tradeIntent: invalid leverage");
  const amount = canonicalActionAmount(String(params.amount), params.market === "WBTC" ? 8 : 18);
  if (!amount) throw new Error("tradeIntent: invalid amount");

  const expMinute = Math.ceil((Date.now() + ttlMs) / 60_000).toString(36);
  const nonce = randomBytes(4).toString("hex"); // 8 chars, CSPRNG
  const body = [
    VERSION,
    marketIdx,
    params.side === "long" ? "l" : "s",
    lev10,
    packAmount(amount),
    expMinute,
    nonce,
  ].join("_");
  const token = `${body}_${sign(body)}`;
  if (Buffer.byteLength(`tc_${token}`) > 64) {
    throw new Error("tradeIntent: amount is too large for a Telegram confirmation");
  }
  return token;
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

  const [, marketIdxS, sideCode, lev10S, amountPacked, expMinuteS, nonce] = parts;
  const market = MARKETS[Number(marketIdxS)];
  const leverage = Number(lev10S) / 10;
  let amount: string;
  try {
    amount = unpackAmount(amountPacked);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const expiresAt = parseInt(expMinuteS, 36) * 60_000;
  if (
    !market ||
    (sideCode !== "l" && sideCode !== "s") ||
    !Number.isFinite(leverage) ||
    leverage <= 0 ||
    !canonicalActionAmount(amount, market === "WBTC" ? 8 : 18) ||
    !Number.isFinite(expiresAt) ||
    !/^[0-9a-f]{8}$/.test(nonce)
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
