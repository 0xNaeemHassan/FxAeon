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

// Privy webhook verification (svix HMAC) was removed in W-12: transaction
// webhooks are a Privy enterprise feature we don't have. Tx lifecycle is
// tracked by the W-11 receipt watcher instead — we broadcast every tx
// ourselves, so polling our own RPC yields the identical information.
export type RequestWithRawBody = Request & { rawBody?: Buffer };
