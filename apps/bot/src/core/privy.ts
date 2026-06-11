/**
 * Single Privy client module (W-08).
 *
 * Replaces two previous parallel modules:
 * - the old core/privy.ts whose createWallet returned a fabricated '0x...' address
 *   (audit P0-8), and
 * - the unwired src/privy/index.ts which created wallets with NO policy attached
 *   and crashed at import time if env vars were missing.
 *
 * Every wallet created here is guarded by the default-deny Privy policy from
 * core/walletPolicy.ts. There is intentionally NO code path that creates an
 * unguarded wallet.
 */
import { PrivyClient } from '@privy-io/server-auth';
import { getConfig, features } from '../middleware/config.js';
import { createPolicyGuardedWallet, type CreatedWallet } from './walletPolicy.js';

let client: PrivyClient | null = null;

/** Lazy singleton — never crashes at import time; fails loudly when actually used. */
export function getPrivy(): PrivyClient {
  if (client) return client;
  const cfg = getConfig();
  if (!cfg.PRIVY_APP_ID || !cfg.PRIVY_APP_SECRET) {
    throw new Error('Privy is not configured (PRIVY_APP_ID / PRIVY_APP_SECRET missing)');
  }
  client = new PrivyClient(cfg.PRIVY_APP_ID, cfg.PRIVY_APP_SECRET, {
    walletApi: cfg.PRIVY_AUTHORIZATION_KEY
      ? { authorizationPrivateKey: cfg.PRIVY_AUTHORIZATION_KEY }
      : undefined,
  });
  return client;
}

export async function verifyUser(token: string): Promise<{
  id: string;
  wallet?: string;
} | null> {
  try {
    const privy = getPrivy();
    const claims = await privy.verifyAuthToken(token);
    // AuthTokenClaims only has userId, appId, issuer, etc.
    // Wallet address must be fetched separately via privy.getUser()
    try {
      const user = await privy.getUser(claims.userId);
      const walletAccount = (user.linkedAccounts as Array<{ type: string; address?: string }>)
        ?.find((a) => a.type === 'wallet');
      return { id: claims.userId, wallet: walletAccount?.address };
    } catch {
      return { id: claims.userId };
    }
  } catch {
    return null;
  }
}

/**
 * Create a Privy user for a Telegram ID WITHOUT an auto-created wallet.
 * (importUser's `createEthereumWallet: true` would create a wallet with no
 * policy attached — wallets must only be created via createWallet below.)
 */
export async function createPrivyUser(telegramId: string) {
  const privy = getPrivy();
  return privy.importUser({
    linkedAccounts: [
      {
        type: 'telegram' as const,
        telegramUserId: telegramId,
      },
    ],
    createEthereumWallet: false,
  });
}

/**
 * Create the user's embedded wallet, guarded by the default-deny policy.
 * Fail-closed: throws if the wallet API is not configured or the policy could
 * not be attached. Idempotent per Privy user (safe to retry).
 */
export async function createWallet(privyUserId: string): Promise<CreatedWallet> {
  return createPolicyGuardedWallet(getPrivy(), privyUserId);
}

/** Send a transaction from a policy-guarded wallet (Privy enforces the policy server-side). */
export async function sendWalletTransaction(
  walletId: string,
  transaction: { to: `0x${string}`; data?: `0x${string}`; value?: `0x${string}` | number }
) {
  if (!features.enablePrivyWalletApi) {
    throw new Error('Privy wallet API is not configured (PRIVY_AUTHORIZATION_KEY missing)');
  }
  return getPrivy().walletApi.ethereum.sendTransaction({
    walletId,
    caip2: 'eip155:1',
    transaction,
  });
}

/** Sign EIP-712 typed data with a policy-guarded wallet (policy restricts the domain). */
export async function signWalletTypedData(
  walletId: string,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
    primaryType: string;
  }
) {
  if (!features.enablePrivyWalletApi) {
    throw new Error('Privy wallet API is not configured (PRIVY_AUTHORIZATION_KEY missing)');
  }
  return getPrivy().walletApi.ethereum.signTypedData({
    walletId,
    typedData: typedData as {
      domain: Record<string, any>;
      types: Record<string, any>;
      message: Record<string, any>;
      primaryType: string;
    },
  });
}

/** Test hook — reset the lazy client. */
export function __resetPrivyClientForTests(): void {
  client = null;
}
