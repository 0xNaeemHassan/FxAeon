/**
 * Delegation gate for chat-based execution.
 *
 * The bot may only sign for a user's wallet while their session-signer grant
 * (bot trading) is active. This helper is the single pre-flight check used by
 * every execution handler:
 *
 *  1. Re-sync from Privy immediately before every money action.
 *  2. Require an active grant, wallet API id, and the same address the route
 *     was built for (a wallet rotation forces the caller to reload state).
 *  3. Any unavailable/mismatched/revoked state fails closed before signing.
 *
 * Privy enforces the same rule server-side regardless — this check only
 * exists so users get clear copy BEFORE a broadcast attempt, not a raw error.
 */
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
  // Always revalidate against Privy immediately before execution. Returning
  // a cached DB grant here left a revocation window until Privy rejected the
  // actual sign call, and could quote/simulate against a wallet that rotated.
  try {
    const synced = await syncWalletState(user);
    if (
      synced.walletDelegated &&
      synced.privyWalletId &&
      synced.walletAddress.toLowerCase() === user.walletAddress.toLowerCase()
    ) {
      return { ok: true, walletId: synced.privyWalletId };
    }
  } catch (e) {
    botLogger.warn({ err: e, userId: user.id }, "delegation revalidation failed closed");
  }

  return { ok: false, message: BOT_TRADING_DISABLED_MESSAGE };
}
