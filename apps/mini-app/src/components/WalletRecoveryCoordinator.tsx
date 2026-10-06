'use client';

import { useEffect, useRef } from 'react';
import { getPublicClient, isRecoveryJournalStorageKey, readPendingHashJournal, readPendingHashes, reconcileWalletJournal } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { useInvalidateWalletData } from '@/components/WalletDataProvider';
import { verifiedRecoveryWalletRefreshes } from '@/lib/walletDataRefresh';
import { createRecoveryTriggerQueue, selectRecoveryTriggerRecords } from '@/lib/recoveryTrigger';

/**
 * Reconcile wallet-submitted hashes on every authenticated route, not only on
 * Portfolio. This coordinator is intentionally invisible and receipt-only:
 * it never resumes an SDK route or treats local storage as protocol state.
 */
export default function WalletRecoveryCoordinator() {
  const wallet = usePrivyWallet();
  const invalidateWalletData = useInvalidateWalletData();
  const refreshedReceipts = useRef(new Set<string>());

  useEffect(() => {
    if (!wallet.ready || !wallet.authenticated || !wallet.address) return;
    const walletAddress = wallet.address as `0x${string}`;
    let cancelled = false;

    const reconcile = createRecoveryTriggerQueue(async (includeTerminalHistory) => {
      if (cancelled) return;
      const stored = includeTerminalHistory ? readPendingHashJournal() : readPendingHashes();
      const records = selectRecoveryTriggerRecords(stored, walletAddress, includeTerminalHistory);
      if (cancelled || records.length === 0) return;
      const views = await reconcileWalletJournal({
        walletAddress,
        records,
        getClient: getPublicClient,
      });
      // A wallet switch invalidates this response. Chain scopes below come
      // from proven journal receipts, never the storage event's local status.
      if (cancelled) return;
      const refreshes = verifiedRecoveryWalletRefreshes(views, walletAddress, refreshedReceipts.current);
      await Promise.all(refreshes.map(async (scope) => {
        if (cancelled) return;
        scope.receiptKeys.forEach((key) => refreshedReceipts.current.add(key));
        try { await invalidateWalletData(scope.address, scope.chainId); }
        catch { /* A failed cache read cannot undo a reconciled receipt. */ }
      }));
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    const onResume = () => void reconcile();
    const onStorage = (event: StorageEvent) => {
      if (isRecoveryJournalStorageKey(event.key)) void reconcile(true);
    };
    void reconcile();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      window.removeEventListener('storage', onStorage);
    };
  }, [invalidateWalletData, wallet.address, wallet.authenticated, wallet.ready]);

  return null;
}
