/**
 * Onboarding — link the USER's wallet + referral write.
 *
 * The policy-wallet era (W-16) created wallets server-side. That is gone:
 * the user creates or imports their embedded wallet in the Mini App via the
 * Privy SDK, and optionally grants the bot a revocable session signer.
 * Onboarding here only LINKS what the user built to a DB row.
 *
 * Security model (unchanged where it matters):
 * - The Mini App's `wallet_connected` payload is a SIGNAL ONLY. Nothing in it
 *   is trusted: the Privy user is resolved server-side from the
 *   webhook-authenticated Telegram user id (unforgeable), and the wallet is
 *   read from Privy's user record — a forged payload can only ever link the
 *   sender's own wallet to the sender's own account.
 * - Idempotent end-to-end: existing DB user → returned as-is (with a
 *   delegation re-sync); existing Privy user → reused.
 * - Referral writes are fail-soft: a bad/unknown/self referral code never
 *   blocks onboarding, it is simply not recorded.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@fxaeon/db";
import { getPrivy, createPrivyUser, getUserWallet } from "./privy.js";
import { botLogger } from "../middleware/logger.js";

export interface OnboardedUser {
  id: string;
  telegramId: string;
  walletAddress: string;
  referralCode: string | null;
  /** True while the user's session-signer grant for chat trading is active. */
  walletDelegated: boolean;
  /** True when the user imported an existing key instead of creating a new one. */
  walletImported: boolean;
}

export type OnboardResult =
  | {
      /** "linked" = wallet newly linked; "existing" = user row already existed. */
      status: "linked" | "existing";
      user: OnboardedUser;
      /** Set when a referral was successfully recorded. */
      referrerCode?: string;
    }
  | {
      /**
       * The user has no embedded wallet on their Privy account yet — they
       * must finish creating/importing it in the Mini App first. Nothing was
       * written to the DB.
       */
      status: "no_wallet";
    };

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
 * Refresh the wallet snapshot (address can rotate only via re-import;
 * delegation toggles whenever the user grants/revokes the session signer).
 * Fail-soft: a Privy read error keeps the stored state.
 */
export async function syncWalletState(user: {
  id: string;
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string | null;
  walletDelegated: boolean;
  walletImported: boolean;
}): Promise<{ walletDelegated: boolean; walletImported: boolean }> {
  try {
    const wallet = await getUserWallet(user.privyUserId);
    if (!wallet) return { walletDelegated: user.walletDelegated, walletImported: user.walletImported };
    const changed =
      wallet.delegated !== user.walletDelegated ||
      wallet.imported !== user.walletImported ||
      (wallet.id ?? null) !== user.privyWalletId ||
      wallet.address.toLowerCase() !== user.walletAddress.toLowerCase();
    if (changed) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          walletDelegated: wallet.delegated,
          walletImported: wallet.imported,
          privyWalletId: wallet.id,
          walletAddress: wallet.address,
        },
      });
    }
    return { walletDelegated: wallet.delegated, walletImported: wallet.imported };
  } catch (e) {
    botLogger.warn({ err: e, userId: user.id }, "wallet state sync failed (using stored state)");
    return { walletDelegated: user.walletDelegated, walletImported: user.walletImported };
  }
}

/**
 * Full onboarding: Privy user → read the USER's wallet → DB user → referral.
 * Never creates a wallet; returns `no_wallet` until the user finished
 * creating/importing one in the Mini App.
 */
export async function onboardUser(
  telegramId: string,
  referralCode?: string
): Promise<OnboardResult> {
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    const synced = await syncWalletState(existing);
    return {
      status: "existing",
      user: {
        id: existing.id,
        telegramId: existing.telegramId,
        walletAddress: existing.walletAddress,
        referralCode: existing.referralCode,
        walletDelegated: synced.walletDelegated,
        walletImported: synced.walletImported,
      },
    };
  }

  const privyUserId = await ensurePrivyUserId(telegramId);
  // The user's own wallet, created/imported client-side. Read-only here.
  const wallet = await getUserWallet(privyUserId);
  if (!wallet) {
    return { status: "no_wallet" };
  }

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
      walletDelegated: wallet.delegated,
      walletImported: wallet.imported,
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
    { telegramId, referred: Boolean(referrer), imported: wallet.imported, delegated: wallet.delegated },
    "user onboarded with self-custodial wallet"
  );

  return {
    status: "linked",
    user: {
      id: user.id,
      telegramId: user.telegramId,
      walletAddress: user.walletAddress,
      referralCode: user.referralCode,
      walletDelegated: wallet.delegated,
      walletImported: wallet.imported,
    },
    referrerCode: referrer ? referralCode : undefined,
  };
}
