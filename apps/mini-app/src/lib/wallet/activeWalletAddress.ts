export type WalletSessionIdentity = {
  ready: boolean;
  authenticated: boolean;
  address?: string;
};

/** Only expose a wallet identity to session UI after the app session is ready. */
export function activeWalletAddress(wallet: WalletSessionIdentity): string | undefined {
  return wallet.ready && wallet.authenticated ? wallet.address : undefined;
}
