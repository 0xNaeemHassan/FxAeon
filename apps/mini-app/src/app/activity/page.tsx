'use client';

import { Activity } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
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
          <>
            <Card className={`${styles.activityCard} ${styles.activityIntro}`}>
              <span className={styles.activityIcon}><Activity className="h-5 w-5" aria-hidden="true" /></span>
              <span><strong className="block text-[13px]">Read-only wallet activity</strong><span className="mt-1 block text-[11.5px] leading-relaxed text-mut">Saved hashes are reconciled against Ethereum or Base. Nothing is resent automatically.</span></span>
            </Card>
            <PendingTransactionRecovery walletAddress={wallet.address as Address} embedded />
          </>
        )}
      </div>
    </AppShell>
  );
}
