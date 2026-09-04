'use client';

import { AppShell } from '@/components/ui';
import PendingTransactionRecovery from '@/components/PendingTransactionRecovery';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { usePrivyWallet } from '@/lib/wallet';
import type { Address } from 'viem';
import styles from '@/app/AccountWorkspace.module.css';

export default function ActivityPage() {
  const wallet = usePrivyWallet();
  return (
    <AppShell title="Activity" subtitle="On-chain status for transactions submitted from this wallet.">
      <div className={`${styles.workspace} ${styles.activitySection}`}>
        {!wallet.address ? (
          <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to check submitted FxAeon transactions." />
        ) : (
          <PendingTransactionRecovery walletAddress={wallet.address as Address} embedded />
        )}
      </div>
    </AppShell>
  );
}
