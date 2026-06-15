/**
 * Single Privy client module — user-owned wallet edition.
 *
 * FxAeon no longer creates server-side "policy wallets". That model (W-08)
 * clashed with f(x) Protocol's self-custody values: the server created the
 * wallet, attached a default-deny policy, and the user could neither import
 * an existing key nor use the wallet outside the bot.
 *
 * The model now is:
 *  - Users CREATE or IMPORT their embedded wallet client-side in the Mini App
 *    via the Privy SDK. Keys live in Privy's TEE; the user can export them at
 *    any time. The wallet is theirs — full stop.
 *  - For chat-based execution the user explicitly grants the bot a SESSION
 *    SIGNER (delegated actions) in the Mini App. The grant is scoped to this
 *    app's key quorum, revocable at any time, and visible in the Mini App.
 *  - The server NEVER creates wallets and NEVER holds keys. It signs only via
 *    `walletApi` for wallets where the user granted delegation; Privy rejects
 *    everything else server-side.
 */
import { PrivyClient } from '@privy-io/server-auth';
import { getConfig, features } from '../middleware/config.js';

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
 * A user's embedded wallet as seen from the server. `delegated` is the single
 * source of truth for whether the bot may sign for this wallet right now.
 */
export interface UserWallet {
  /** Privy wallet API id. Null until the wallet is delegated or on the unified stack. */
  id: string | null;
  address: `0x${string}`;
  /** True when the user imported an existing private key (vs created fresh). */
  imported: boolean;
  /** True while the user's session-signer grant for this app is active. */
  delegated: boolean;
}

interface LinkedWalletAccount {
  type: string;
  chainType?: string;
  walletClientType?: string;
  address?: string;
  id?: string | null;
  imported?: boolean;
  delegated?: boolean;
}

/**
 * Resolve the embedded Ethereum wallet of a Privy user — the wallet the USER
 * created or imported in the Mini App. Returns null when the user hasn't
 * finished wallet setup yet. Never creates anything.
 */
export async function getUserWallet(privyUserId: string): Promise<UserWallet | null> {
  const privy = getPrivy();
  const user = await privy.getUser(privyUserId);
  const account = (user.linkedAccounts as LinkedWalletAccount[]).find(
    (a) =>
      a.type === 'wallet' &&
      a.walletClientType === 'privy' &&
      (a.chainType === undefined || a.chainType === 'ethereum') &&
      typeof a.address === 'string' &&
      a.address.startsWith('0x')
  );
  if (!account) return null;
  return {
    id: account.id ?? null,
    address: account.address as `0x${string}`,
    imported: account.imported === true,
    delegated: account.delegated === true,
  };
}

/**
 * Create a Privy user for a Telegram ID WITHOUT a wallet. Wallets are created
 * or imported BY THE USER in the Mini App — never server-side.
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

/** Raised when the bot tries to sign for a wallet without an active delegation grant. */
export class WalletNotDelegatedError extends Error {
  constructor(message = 'wallet not delegated — the user has not granted (or has revoked) bot trading access') {
    super(message);
    this.name = 'WalletNotDelegatedError';
  }
}

/**
 * Send a transaction from a user's wallet via the session-signer grant.
 * Privy enforces server-side that this app's key quorum is an active signer
 * on the wallet; without the user's grant the call fails — fail-closed.
 */
export async function sendWalletTransaction(
  walletId: string,
  transaction: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: `0x${string}` | number;
    nonce?: `0x${string}` | number;
    chainId?: `0x${string}` | number;
    type?: 0 | 1 | 2;
    gasLimit?: `0x${string}` | number;
    maxFeePerGas?: `0x${string}` | number;
    maxPriorityFeePerGas?: `0x${string}` | number;
  }
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

/**
 * Sign (but do NOT broadcast) a transaction from a user's wallet via the
 * session-signer grant. Used for private/MEV-protected submission: we sign
 * here, then broadcast the raw tx ourselves to Flashbots Protect (see
 * core/broadcast.ts). Because Privy never broadcasts this tx it cannot fill in
 * nonce / gas / fees — the caller MUST pass them all explicitly.
 */
export async function signWalletTransaction(
  walletId: string,
  transaction: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: `0x${string}` | number;
    nonce?: `0x${string}` | number;
    chainId?: `0x${string}` | number;
    type?: 0 | 1 | 2;
    gasLimit?: `0x${string}` | number;
    maxFeePerGas?: `0x${string}` | number;
    maxPriorityFeePerGas?: `0x${string}` | number;
  }
): Promise<{ signedTransaction: `0x${string}`; encoding: string }> {
  if (!features.enablePrivyWalletApi) {
    throw new Error('Privy wallet API is not configured (PRIVY_AUTHORIZATION_KEY missing)');
  }
  const res = await getPrivy().walletApi.ethereum.signTransaction({ walletId, transaction });
  return {
    signedTransaction: res.signedTransaction as `0x${string}`,
    encoding: res.encoding,
  };
}

/** Sign EIP-712 typed data with a user's wallet via the session-signer grant. */
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
