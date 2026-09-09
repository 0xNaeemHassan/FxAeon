'use client';

import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, History, ChevronRight, QrCode, RefreshCw, Settings, Wallet } from 'lucide-react';
import Link from 'next/link';
import { AppShell, AddressChip, Card } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import styles from '@/components/UtilitySurfaces.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import AppearancePreference from '@/components/AppearancePreference';

/** Secondary destinations only. Primary trading flows stay in the tab bar. */
export default function MorePage() {
  return (
    <AppShell title="More">
      <div className={`${styles.utilityWorkspace} ${styles.moreWorkspace}`}>
        <WalletSummary />

        <Section label="Account">
          <MoreRow href="/history" icon={History} title="History" body="Pending and completed transactions" />
          <MoreRow href="/qr" icon={QrCode} title="Receive" body="Wallet address and QR code" />
          <MoreRow href="/settings" icon={Settings} title="Settings" body="Wallet and preferences" />
        </Section>

        <Section label="Resources">
          <MoreRow href="/docs" icon={BookOpen} title="FxAeon docs" body="Guides for wallets, trading, and actions" />
        </Section>

        <AppearancePreference />
      </div>
    </AppShell>
  );
}

function WalletSummary() {
  const walletState = usePrivyWallet();
  const { ready, authenticated } = walletState;
  const wallet = walletState.selectedWallet;
  const timedOut = useWalletReadyTimeout(ready && walletState.ready);

  if (!ready || !walletState.ready) {
    if (timedOut) {
      return (
        <div role="status" aria-live="polite"><Card className={`${styles.utilityCard} flex items-center gap-3 p-3`}>
          <span className="text-[12px] text-warn">Wallet provider is unavailable.</span>
          <button type="button" aria-label="Retry wallet provider" onClick={() => window.location.reload()} className="glass-press ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
        </Card></div>
      );
    }
    return <div role="status" aria-live="polite"><Card className={`${styles.utilityCard} h-14 animate-pulse`}><span className="sr-only">Loading wallet</span></Card></div>;
  }

  if (!authenticated || !wallet) {
    return (
      <Card className={`${styles.utilityCard} flex items-center gap-2.5 p-3`}>
        <Wallet className="h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">Connect a wallet</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mut">Your wallet and address appear here after connection.</p>
        </div>
        <ConnectWalletButton aria-label={authenticated ? 'Choose wallet' : 'Connect wallet'} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-[var(--mint-dim)] text-mint">
          <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
        </ConnectWalletButton>
      </Card>
    );
  }

  return (
    <Card className={`${styles.utilityCard} p-3`}>
      <div className="flex items-center gap-2.5">
        <Wallet className="h-[18px] w-[18px] shrink-0 text-mint" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-mut">Connected wallet</p>
          <div className="mt-1"><AddressChip address={wallet.address} /></div>
        </div>
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = `more-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className={styles.utilitySection} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionLabel}>{label}</h2>
      <div className={`${styles.rowGroup} ${styles.actionGrid}`}>{children}</div>
    </section>
  );
}

function MoreRow({ href, icon: Icon, title, body }: { href: string; icon: LucideIcon; title: string; body: string }) {
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-mint" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-mut">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />
    </>
  );
  const className = `${styles.moreRow} glass-press flex min-h-12 items-center gap-2.5 px-3 py-2`;
  return <Link href={href} onClick={() => haptic('light')} className={className}>{inner}</Link>;
}
