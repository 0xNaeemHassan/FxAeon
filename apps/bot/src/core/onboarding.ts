/**
 * Onboarding — server-side wallet creation + referral write (W-16).
 *
 * Design decisions (security):
 * - The Mini App's `wallet_connected` payload is treated as a SIGNAL ONLY.
 *   Nothing in it is trusted: the Privy user is resolved server-side from the
 *   webhook-authenticated Telegram user id (unforgeable), and the wallet is
 *   created server-side via the W-08 default-deny Policy Engine path. A forged
 *   payload can therefore only ever onboard the sender themselves.
 * - Idempotent end-to-end: existing DB user → returned as-is; existing Privy
 *   user → reused; wallet creation reuses Privy's idempotency key (W-08).
 * - Referral writes are fail-soft: a bad/unknown/self referral code never
 *   blocks wallet creation, it is simply not recorded.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@fxbot/db";
import { getPrivy, createPrivyUser, createWallet } from "./privy.js";
import { botLogger } from "../middleware/logger.js";

export interface OnboardResult {
  /** "created" = new wallet + user row; "existing" = user was already onboarded. */
  status: "created" | "existing";
  user: {
    id: string;
    telegramId: string;
    walletAddress: string;
    referralCode: string | null;
  };
  /** Set when a referral was successfully recorded. */
  referrerCode?: string;
}

/** Crockford-ish referral code: 8 chars, unambiguous, CSPRNG (not Math.random). */
export function generateReferralCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

/** Extract a referral code from a /start deep-link payload ("ref_XXXX"). */
export function parseReferralPayload(text: string | undefined): string | undefined {
  const payload = text?.split(" ")[1];
  if (!payload) return undefined;
  const m = /^ref_([A-Za-z0-9]{4,16})$/.exec(payload);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Resolve (or create) the Privy user for a Telegram id — server-side only.
 * The telegramId comes from the authenticated webhook update, never from
 * client-supplied data.
 */
export async function ensurePrivyUserId(telegramId: string): Promise<string> {
  const privy = getPrivy();
  const existing = await privy.getUserByTelegramUserId(telegramId).catch(() => null);
  if (existing) return existing.id;
  const created = await createPrivyUser(telegramId);
  return created.id;
}

/**
 * Full onboarding: Privy user → policy-guarded wallet → DB user → referral.
 * Throws only when wallet creation itself fails (fail-closed, W-08).
 */
export async function onboardUser(
  telegramId: string,
  referralCode?: string
): Promise<OnboardResult> {
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return {
      status: "existing",
      user: {
        id: existing.id,
        telegramId: existing.telegramId,
        walletAddress: existing.walletAddress,
        referralCode: existing.referralCode,
      },
    };
  }

  const privyUserId = await ensurePrivyUserId(telegramId);
  // Policy-guarded, fail-closed, idempotent per Privy user (W-08).
  const wallet = await createWallet(privyUserId);

  // Resolve referrer BEFORE create so we can write referredBy atomically.
  let referrer: { id: string; referralCode: string | null } | null = null;
  if (referralCode) {
    referrer = await prisma.user
      .findUnique({ where: { referralCode } })
      .catch(() => null);
  }

  const user = await prisma.user.create({
    data: {
      telegramId,
      privyUserId,
      privyWalletId: wallet.id,
      walletAddress: wallet.address,
      referralCode: generateReferralCode(),
      referredBy: referrer?.id ?? null,
    },
  });

  if (referrer) {
    // Self-referral is impossible here (the new user row didn't exist when the
    // code was resolved), but guard anyway.
    if (referrer.id !== user.id) {
      await prisma.referral
        .create({
          data: {
            // Referral.code is unique per row; the relationship row gets its
            // own id-like code (refer.ts aggregates by referrerId, not code).
            code: `${referralCode}-${user.telegramId}`,
            referrerId: referrer.id,
            refereeId: user.id,
          },
        })
        .catch((e: unknown) => {
          botLogger.warn({ err: e }, "referral write failed (non-blocking)");
        });
    }
  }

  botLogger.info(
    { telegramId, referred: Boolean(referrer) },
    "user onboarded with policy-guarded wallet"
  );

  return {
    status: "created",
    user: {
      id: user.id,
      telegramId: user.telegramId,
      walletAddress: user.walletAddress,
      referralCode: user.referralCode,
    },
    referrerCode: referrer ? referralCode : undefined,
  };
}
