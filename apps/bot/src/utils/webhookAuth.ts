import crypto from "node:crypto";
import type { Request } from "express";

/**
 * Webhook authentication helpers (AUDIT.md P0-5, PLAN.md W-03).
 *
 * - Telegram: secret token passed to setWebhook and validated by grammY's
 *   webhookCallback (constant-time, handled in main.ts).
 * - Privy: SVIX-style HMAC-SHA256 signature verification, implemented here
 *   with node:crypto only (no new dependency).
 */

const MAX_SKEW_SECONDS = 5 * 60;

export function getTelegramWebhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET is required in production (generate with: openssl rand -hex 32)"
    );
  }
  // Dev fallback: random per-boot secret (dev uses long polling anyway).
  return crypto.randomBytes(32).toString("hex");
}

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Privy (SVIX) webhook signature against the raw request body.
 * Spec: signedContent = `${id}.${timestamp}.${rawBody}`,
 * HMAC-SHA256 keyed with base64-decoded portion of `whsec_<base64>`,
 * compared (constant-time) against each `v1,<base64sig>` in the header.
 */
export function verifySvixSignature(
  rawBody: Buffer | string,
  headers: SvixHeaders,
  webhookSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing svix headers" };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const secretB64 = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice("whsec_".length)
    : webhookSecret;
  let key: Buffer;
  try {
    key = Buffer.from(secretB64, "base64");
  } catch {
    return { ok: false, reason: "invalid webhook secret" };
  }
  if (key.length === 0) return { ok: false, reason: "invalid webhook secret" };

  const signedContent = `${id}.${ts}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest();

  // Header may contain multiple space-delimited signatures: "v1,<b64> v1,<b64>"
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

export type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Verify an incoming Privy webhook request. Returns { ok: false } when the
 * signing secret is not configured (fail closed) or verification fails.
 */
export function verifyPrivyRequest(req: RequestWithRawBody): VerifyResult {
  const secret = process.env.PRIVY_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, reason: "PRIVY_WEBHOOK_SECRET not configured" };
  }
  if (!req.rawBody) {
    return { ok: false, reason: "raw body unavailable" };
  }
  return verifySvixSignature(
    req.rawBody,
    {
      id: req.headers["svix-id"] as string | undefined,
      timestamp: req.headers["svix-timestamp"] as string | undefined,
      signature: req.headers["svix-signature"] as string | undefined,
    },
    secret
  );
}
