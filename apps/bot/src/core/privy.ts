import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config';

export const privy = new PrivyClient(
  config.PRIVY_APP_ID,
  config.PRIVY_APP_SECRET
);

export async function verifyUser(token: string): Promise<{
  id: string;
  wallet?: string;
} | null> {
  try {
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

export async function createWallet(userId: string): Promise<{ address: string }> {
  // NOTE: Implement embedded wallet creation in production
  return { address: '0x...' };
}
