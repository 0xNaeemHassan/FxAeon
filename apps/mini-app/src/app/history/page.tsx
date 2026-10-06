'use client';

import { AppShell } from '@/components/ui';
import WalletActivity from '@/components/WalletActivity';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { usePrivyWallet } from '@/lib/wallet';
import type { Address } from 'viem';
import styles from '@/app/AccountWorkspace.module.css';

/** Canonical wallet-scoped journal route. */
export default function HistoryPage() {
  const wallet = usePrivyWallet();
  return (
    <AppShell title="History">
      <div className={`${styles.workspace} ${styles.activitySection} ${styles.activityCompactWorkspace}`}>
        {!wallet.address ? (
          <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect to see your activity." />
        ) : (
          <WalletActivity walletAddress={wallet.address as Address} />
        )}
      </div>
    </AppShell>
  );
}
