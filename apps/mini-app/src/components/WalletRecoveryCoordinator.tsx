'use client';

import { useEffect } from 'react';
import { getPublicClient, readPendingHashes, reconcileWalletJournal } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Reconcile wallet-submitted hashes on every authenticated route, not only on
 * Portfolio. This coordinator is intentionally invisible and receipt-only:
 * it never resumes an SDK route or treats local storage as protocol state.
 */
export default function WalletRecoveryCoordinator() {
  const wallet = usePrivyWallet();

  useEffect(() => {
    if (!wallet.ready || !wallet.authenticated || !wallet.address) return;
    let cancelled = false;

    const reconcile = async () => {
      const pending = readPendingHashes();
      if (cancelled || pending.length === 0) return;
      try {
        await reconcileWalletJournal({
          walletAddress: wallet.address as `0x${string}`,
          records: pending,
          getClient: getPublicClient,
        });
      } catch {
        // Recovery is best-effort and read-only. A provider outage must not
        // interrupt the active screen or mutate a pending record to failure.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    const onStorage = () => void reconcile();
    void reconcile();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [wallet.address, wallet.authenticated, wallet.ready]);

  return null;
}
