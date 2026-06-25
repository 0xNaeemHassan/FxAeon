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

export type RequestWithRawBody = Request & { rawBody?: Buffer };
