/**
 * BotState — persistent key/value store for operational state.
 *
 * Used by the webhook registration skip-noop logic: on every cold start the
 * bot checks whether the webhook URL it wants to register is already the one
 * stored from the last boot. If it matches, `setWebhook` is skipped entirely,
 * avoiding Telegram's aggressive rate-limit on the endpoint.
 *
 * Also stores deploy IDs, feature-flag overrides, and the last successful
 * webhook registration timestamp.
 */
import { prisma } from "@fxaeon/db";

export async function getBotState(key: string): Promise<string | null> {
  const row = await prisma.botState.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setBotState(key: string, value: string): Promise<void> {
  await prisma.botState.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

// ── Well-known keys ─────────────────────────────────────────────────────
export const BS_WEBHOOK_URL = "webhook_url";
export const BS_WEBHOOK_SECRET = "webhook_secret";
export const BS_DEPLOY_ID = "deploy_id";
export const BS_FEE_MODE = "fee_mode";
export const BS_POLICY_MODE = "policy_mode";
