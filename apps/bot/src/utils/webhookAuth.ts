import crypto from "node:crypto";
import type { Request } from "express";

/**
 * Webhook authentication helpers (AUDIT.md P0-5, PLAN.md W-03).
 *
 * - Telegram: secret token passed to setWebhook and validated by grammY's
 *   webhookCallback (constant-time, handled in main.ts).
 *
 * The Privy SVIX webhook verifier that once lived here was removed in W-12:
 * transaction webhooks are a Privy enterprise feature we don't have. Tx
 * lifecycle is tracked by the W-11 receipt watcher instead.
 */

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

/**
 * Non-reversible marker persisted with the registered webhook URL. Comparing
 * URL alone is unsafe for availability: after a secret rotation Telegram
 * would keep sending the old header while the bot expected the new one.
 */
export function webhookSecretFingerprint(secret: string): string {
  return crypto
    .createHash("sha256")
    .update("fxaeon-telegram-webhook-secret-v1\0")
    .update(secret)
    .digest("hex");
}

/** Build the one canonical Telegram endpoint from a validated public origin. */
export function webhookEndpointFromOrigin(origin: string): string {
  const parsed = new URL(origin);
  return new URL("/webhook", `${parsed.origin}/`).toString();
}

export type RequestWithRawBody = Request & { rawBody?: Buffer };
