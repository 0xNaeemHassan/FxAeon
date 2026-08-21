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
 * Format: a2.<kind>.<p1>.<p2>.<p3>.<expMinute36>.<nonce>.<sig>
 * - kind: 2-letter action code (see ActionKind).
 * - p1..p3: action params; decimal amounts use an exact compact base36 form.
 * - Stays under Telegram's 64-byte callback_data cap (handlers register the
 *   token itself as callback data, no extra prefix).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ActionKind =
  | "sd" // fxSAVE deposit:  p1 = token ("f" fxUSD | "u" USDC), p2 = amount micro
  | "sw" // fxSAVE withdraw: p1 = mode ("i" instant | "c" cooldown), p2 = shares micro (0 = all)
  | "sc" // fxSAVE claim:    no params
  | "mt" // deposit & mint:  p1 = market idx, p2 = collateral micro, p3 = fxUSD micro
  | "rp" // repay:           p1 = market idx, p2 = positionId, p3 = repay micro (0 = all)
  | "br"; // bridge Eth→Base: p1 = token ("f" fxUSD | "s" fxSAVE), p2 = amount micro

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

const VERSION = "a2";
const KINDS: ReadonlySet<string> = new Set(["sd", "sw", "sc", "mt", "rp", "br"]);
export const ACTION_INTENT_TTL_MS = 10 * 60 * 1000;

type DecimalInput = string | number;

function normalizeDecimal(
  raw: DecimalInput,
  maxDecimals: number,
  allowZero: boolean
): string | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  const input = String(raw).trim();
  if (!input || input.length > 100) return null;
  // Allow either plain digits or correctly grouped thousands separators.
  // Scientific notation and signs are intentionally rejected.
  if (!/^(?:(?:\d{1,3}(?:,\d{3})+)|\d+|\.\d+)(?:\.\d+)?$/.test(input)) return null;
  const value = input.replace(/,/g, "");
  const [wholeRaw = "0", fractionRaw = ""] = value.startsWith(".")
    ? ["0", value.slice(1)]
    : value.split(".");
  if (fractionRaw.length > maxDecimals) return null;
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.replace(/0+$/, "");
  const coefficient = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  if (!allowZero && coefficient === "0") return null;
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Validate and canonicalize a positive user amount without IEEE-754 coercion. */
export function canonicalActionAmount(raw: string, maxDecimals: number): string | null {
  return normalizeDecimal(raw, maxDecimals, false);
}

/** Exact decimal encoding: one base36 scale digit followed by a base36 coefficient. */
export function packAmount(amount: DecimalInput): string {
  const canonical = normalizeDecimal(amount, 35, true);
  if (canonical == null) throw new Error("actionIntent: invalid amount");
  if (canonical === "0") return "0"; // reserved ALL sentinel where supported
  const [whole, fraction = ""] = canonical.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return `${fraction.length.toString(36)}${coefficient.toString(36)}`;
}

function base36BigInt(value: string): bigint {
  if (!/^[0-9a-z]+$/.test(value)) throw new Error("actionIntent: invalid packed amount");
  let result = 0n;
  for (const char of value) {
    const digit = parseInt(char, 36);
    result = result * 36n + BigInt(digit);
  }
  return result;
}

/** Decode an amount to a canonical decimal string, preserving every digit. */
export function unpackAmount(packed: string): string {
  if (packed === "0") return "0";
  if (!/^[0-9a-z]{2,30}$/.test(packed)) {
    throw new Error("actionIntent: invalid packed amount");
  }
  const scale = parseInt(packed[0], 36);
  const digits = base36BigInt(packed.slice(1)).toString(10);
  if (scale === 0) return digits;
  if (digits.length <= scale) return `0.${"0".repeat(scale - digits.length)}${digits}`;
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function signingKey(): Buffer {
  const seed = process.env.INTENT_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!seed) {
    throw new Error(
      "actionIntent: set INTENT_SECRET or TELEGRAM_BOT_TOKEN — refusing to sign with an empty key"
    );
  }
  // Domain-separate from the raw bot token AND from trade intents.
  return createHmac("sha256", seed).update("fxaeon-action-intent-v2").digest();
}

function sign(body: string): string {
  // 64-bit truncated HMAC: adequate for a 10-minute online-only token where
  // every guess costs a Telegram callback round-trip; keeps total ≤64 bytes.
  return createHmac("sha256", signingKey())
    .update(body)
    .digest()
    .subarray(0, 8)
    .toString("base64url");
}

export function createActionIntent(
  kind: ActionKind,
  params: { p1?: string; p2?: string; p3?: string },
  ttlMs: number = ACTION_INTENT_TTL_MS
): string {
  if (!KINDS.has(kind)) throw new Error(`actionIntent: unknown kind ${kind}`);
  const clean = (v: string | undefined) => {
    const s = v ?? "0";
    if (!/^[a-z0-9]{1,30}$/i.test(s)) throw new Error(`actionIntent: bad param ${s}`);
    return s;
  };
  const expMinute = Math.ceil((Date.now() + ttlMs) / 60_000).toString(36);
  const nonce = randomBytes(4).toString("hex"); // 8 chars, CSPRNG
  const body = [VERSION, kind, clean(params.p1), clean(params.p2), clean(params.p3), expMinute, nonce].join(".");
  const token = `${body}.${sign(body)}`;
  if (token.length > 64) throw new Error(`actionIntent: token too long (${token.length})`);
  return token;
}

export function looksLikeActionIntent(token: string | undefined): token is string {
  return typeof token === "string" && token.startsWith(`${VERSION}.`);
}

export function verifyActionIntent(token: string): VerifyActionResult {
  const parts = token.split(".");
  if (parts.length !== 8 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };

  const body = parts.slice(0, 7).join(".");
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
