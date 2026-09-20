'use client';

import { type ReactNode, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, CircleCheck, History, ChevronRight, ExternalLink, LogOut, MessageCircleQuestionMark, QrCode, RefreshCw, Settings, Wallet } from 'lucide-react';
import Link from 'next/link';
import { AppShell, AddressChip, Card } from '@/components/ui';
import { haptic, openExternalLink } from '@/lib/telegram';
import { userSafeError } from '@/lib/errors';
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
          <MoreRow href="/history" icon={History} title="History" />
          <MoreRow href="/qr" icon={QrCode} title="Receive" />
          <MoreRow href="/settings" icon={Settings} title="Settings" />
        </Section>

        <Section label="Resources">
          <MoreRow href="/docs" icon={BookOpen} title="FxAeon docs" />
          <MoreExternalRow href="https://fxprotocol.gitbook.io/fx-docs" icon={BookOpen} title="f(x) protocol docs" />
          <MoreExternalRow href="https://x.com/FxAeonxyz" icon={MessageCircleQuestionMark} title="Support on X" />
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
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const disconnect = async () => {
    setDisconnectError('');
    setDisconnecting(true);
    try {
      await walletState.disconnect();
      haptic('success');
    } catch (cause) {
      setDisconnectError(userSafeError(cause, 'Wallet disconnect could not be completed.'));
      haptic('error');
    } finally {
      setDisconnecting(false);
    }
  };

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
          <p className="text-[13.5px] font-medium">{authenticated ? 'Choose a wallet' : 'Connect a wallet'}</p>
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
          <p className="flex items-center gap-1.5 text-[12px] text-mut"><CircleCheck className="h-3.5 w-3.5 text-mint" aria-hidden="true" />Connected wallet</p>
          <div className="mt-1"><AddressChip address={wallet.address} /></div>
        </div>
      </div>
      <button type="button" onClick={() => void disconnect()} disabled={disconnecting} aria-busy={disconnecting || undefined} className="button glass-press mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[rgba(255,90,95,0.28)] bg-[rgba(255,90,95,0.1)] px-3 text-[12px] font-semibold text-danger disabled:opacity-60">
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {disconnecting ? 'Disconnecting…' : 'Disconnect wallet'}
      </button>
      {disconnectError && <p role="alert" className="mt-2 rounded-xl bg-[var(--danger-dim)] p-3 text-[12px] text-danger">{disconnectError}</p>}
    </Card>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = `more-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className={`${styles.utilitySection} ${label === 'Resources' ? styles.resourceSection : ''}`} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionLabel}>{label}</h2>
      <div className={`${styles.rowGroup} ${styles.actionGrid}`}>{children}</div>
    </section>
  );
}

function MoreRow({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }) {
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-mint" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13.5px] font-medium">{title}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />
    </>
  );
  const className = `${styles.moreRow} glass-press flex min-h-12 items-center gap-2.5 px-3 py-2`;
  return <Link href={href} onClick={() => haptic('light')} className={className}>{inner}</Link>;
}

function MoreExternalRow({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }) {
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-mint" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13.5px] font-medium">{title}</span>
      <ExternalLink className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />
    </>
  );
  const className = `${styles.moreRow} glass-press flex min-h-12 items-center gap-2.5 px-3 py-2`;
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${title} (opens in a new tab)`} onClick={(event) => { haptic('light'); if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) event.preventDefault(); }} className={className}>{inner}</a>;
}
