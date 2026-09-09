'use client';

import { AppShell } from '@/components/ui';
import PendingTransactionRecovery from '@/components/PendingTransactionRecovery';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { usePrivyWallet } from '@/lib/wallet';
import type { Address } from 'viem';
import styles from '@/app/AccountWorkspace.module.css';

/** Canonical wallet-scoped journal route. */
export default function HistoryPage() {
  const wallet = usePrivyWallet();
  return (
    <AppShell title="History" subtitle="Status for transactions and reviews from this wallet.">
      <div className={`${styles.workspace} ${styles.activitySection} ${styles.activityCompactWorkspace}`}>
        {!wallet.address ? (
          <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect to view this wallet's pending and completed actions." />
        ) : (
          <PendingTransactionRecovery walletAddress={wallet.address as Address} embedded />
        )}
      </div>
    </AppShell>
  );
}
