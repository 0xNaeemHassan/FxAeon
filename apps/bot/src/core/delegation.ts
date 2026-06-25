/**
 * Delegation gate for chat-based execution.
 *
 * The bot may only sign for a user's wallet while their session-signer grant
 * (bot trading) is active. This helper is the single pre-flight check used by
 * every execution handler:
 *
 *  1. If the DB says the wallet is delegated and we have a wallet id → go.
 *  2. Otherwise re-sync once from Privy (the user may have just granted or
 *     revoked access in the Mini App) and re-check.
 *  3. Still not delegated → return honest, actionable copy. Nothing is sent.
 *
 * Privy enforces the same rule server-side regardless — this check only
 * exists so users get clear copy BEFORE a broadcast attempt, not a raw error.
 */
import { prisma } from "@fxaeon/db";
import { syncWalletState } from "./onboarding.js";
import { botLogger } from "../middleware/logger.js";

export const BOT_TRADING_DISABLED_MESSAGE =
  `🔐 Bot trading is off for your wallet.\n\n` +
  `Your wallet is self-custodial — the bot can only sign when you allow it. ` +
  `Open the Mini App → Settings → Wallet and enable bot trading (you can ` +
  `revoke it any time). Nothing was sent.`;

export interface DelegationGateUser {
  id: string;
  privyUserId: string;
  walletAddress: string;
  privyWalletId: string | null;
  walletDelegated: boolean;
  walletImported: boolean;
}

export type DelegationGateResult =
  | { ok: true; walletId: string }
  | { ok: false; message: string };

export async function requireDelegatedWallet(
  user: DelegationGateUser
): Promise<DelegationGateResult> {
  if (user.walletDelegated && user.privyWalletId) {
    return { ok: true, walletId: user.privyWalletId };
  }

  // One re-sync: delegation may have been granted seconds ago in the Mini App.
  try {
    await syncWalletState(user);
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (fresh?.walletDelegated && fresh.privyWalletId) {
      return { ok: true, walletId: fresh.privyWalletId };
    }
  } catch (e) {
    botLogger.warn({ err: e, userId: user.id }, "delegation re-sync failed");
  }

  return { ok: false, message: BOT_TRADING_DISABLED_MESSAGE };
}
