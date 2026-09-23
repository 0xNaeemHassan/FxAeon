'use client';

import { AppShell } from '@/components/ui';
import PendingTransactionRecovery from '@/components/PendingTransactionRecovery';
import ProtocolPositionHistory from '@/components/ProtocolPositionHistory';
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
          <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect to see this wallet's indexed position activity and saved transaction history." />
        ) : (
          <>
            <ProtocolPositionHistory walletAddress={wallet.address as Address} />
            <PendingTransactionRecovery walletAddress={wallet.address as Address} embedded />
          </>
        )}
      </div>
    </AppShell>
  );
}
