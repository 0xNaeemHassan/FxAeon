import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config';

export const privy = new PrivyClient(
  config.PRIVY_APP_ID,
  config.PRIVY_APP_SECRET
);

export async function verifyUser(token: string): Promise<<<{
  id: string;
  wallet?: string;
} | null> {
  try {
    const user = await privy.verifyAuthToken(token);
    return { id: user.userId, wallet: user.linkedAccounts?.[0]?.address ?? undefined };
  } catch {
    return null;
  }
}

export async function createWallet(userId: string): Promise<<<{ address: string }> {
  // NOTE: Implement embedded wallet creation in production
  return { address: '0x...' };
}
