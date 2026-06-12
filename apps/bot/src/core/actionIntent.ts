/**
 * Signed action intents — the generic sibling of tradeIntent (W-17).
 *
 * Covers every non-trade on-chain action that needs a Confirm button:
 * fxSAVE deposit / withdraw / claim, deposit-and-mint, repay.
 *
 * Same security model as trade intents:
 * - HMAC-signed over every field → callback_data can't be tampered with.
 * - Short TTL → no stale-price replays.
 * - NO user identity in the token → execution always uses the wallet of the
 *   Telegram user who pressed the button.
 * - The nonce feeds the executor idempotency key → double-taps dedupe.
 *
 * Format: a1_<kind>_<p1>_<p2>_<p3>_<expMinute36>_<nonce>_<sig>
 * - kind: 2-letter action code (see ActionKind).
 * - p1..p3: action params; numbers are base36-encoded integers.
 * - Stays under Telegram's 64-byte callback_data cap (handlers register the
 *   token itself as callback data, no extra prefix).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ActionKind =
  | "sd" // fxSAVE deposit:  p1 = token ("f" fxUSD | "u" USDC), p2 = amount micro
  | "sw" // fxSAVE withdraw: p1 = mode ("i" instant | "c" cooldown), p2 = shares micro (0 = all)
  | "sc" // fxSAVE claim:    no params
  | "mt" // deposit & mint:  p1 = market idx, p2 = collateral micro, p3 = fxUSD micro
  | "rp"; // repay:          p1 = market idx, p2 = positionId, p3 = repay micro (0 = all)

export interface ActionIntent {
  kind: ActionKind;
  p1: string;
  p2: string;
  p3: string;
  nonce: string;
  expiresAt: number;
}

export type VerifyActionResult =
  | { ok: true; intent: ActionIntent }
  | { ok: false; reason: "malformed" | "tampered" | "expired" };

const VERSION = "a1";
const KINDS: ReadonlySet<string> = new Set(["sd", "sw", "sc", "mt", "rp"]);
export const ACTION_INTENT_TTL_MS = 10 * 60 * 1000;

/** Micro-unit (1e6) fixed-point for human amounts, base36-packed. */
export function packAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("actionIntent: invalid amount");
  return Math.round(amount * 1e6).toString(36);
}

export function unpackAmount(packed: string): number {
  const micro = parseInt(packed, 36);
  if (!Number.isFinite(micro) || micro < 0) throw new Error("actionIntent: invalid packed amount");
  return micro / 1e6;
}

function signingKey(): Buffer {
  const seed = process.env.INTENT_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!seed) {
    throw new Error(
      "actionIntent: set INTENT_SECRET or TELEGRAM_BOT_TOKEN — refusing to sign with an empty key"
    );
  }
  // Domain-separate from the raw bot token AND from trade intents.
  return createHmac("sha256", seed).update("fxaeon-action-intent-v1").digest();
}

function sign(body: string): string {
  // 64-bit truncated HMAC: adequate for a 10-minute online-only token where
  // every guess costs a Telegram callback round-trip; keeps total ≤64 bytes.
  return createHmac("sha256", signingKey()).update(body).digest("hex").slice(0, 16);
}

export function createActionIntent(
  kind: ActionKind,
  params: { p1?: string; p2?: string; p3?: string },
  ttlMs: number = ACTION_INTENT_TTL_MS
): string {
  if (!KINDS.has(kind)) throw new Error(`actionIntent: unknown kind ${kind}`);
  const clean = (v: string | undefined) => {
    const s = v ?? "0";
    if (!/^[a-z0-9]{1,12}$/i.test(s)) throw new Error(`actionIntent: bad param ${s}`);
    return s;
  };
  const expMinute = Math.ceil((Date.now() + ttlMs) / 60_000).toString(36);
  const nonce = randomBytes(4).toString("hex"); // 8 chars, CSPRNG
  const body = [VERSION, kind, clean(params.p1), clean(params.p2), clean(params.p3), expMinute, nonce].join("_");
  const token = `${body}_${sign(body)}`;
  if (token.length > 64) throw new Error(`actionIntent: token too long (${token.length})`);
  return token;
}

export function looksLikeActionIntent(token: string | undefined): token is string {
  return typeof token === "string" && token.startsWith(`${VERSION}_`);
}

export function verifyActionIntent(token: string): VerifyActionResult {
  const parts = token.split("_");
  if (parts.length !== 8 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };

  const body = parts.slice(0, 7).join("_");
  const givenSig = Buffer.from(parts[7]);
  const expectSig = Buffer.from(sign(body));
  if (givenSig.length !== expectSig.length || !timingSafeEqual(givenSig, expectSig)) {
    return { ok: false, reason: "tampered" };
  }

  const [, kind, p1, p2, p3, expMinute36, nonce] = parts;
  if (!KINDS.has(kind)) return { ok: false, reason: "malformed" };
  const expiresAt = parseInt(expMinute36, 36) * 60_000;
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (Date.now() > expiresAt) return { ok: false, reason: "expired" };

  return { ok: true, intent: { kind: kind as ActionKind, p1, p2, p3, nonce, expiresAt } };
}
