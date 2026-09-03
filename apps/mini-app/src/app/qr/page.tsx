'use client';

import { useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy, Wallet } from 'lucide-react';
import { AppShell, Card, copyText, EmptyState } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/UtilitySurfaces.module.css';

/**
 * Receive screen. The address is read from the selected Privy wallet only;
 * query strings, Telegram user IDs, and server responses never get to choose
 * a deposit destination.
 */
export default function QRPage() {
  return (
    <AppShell title="Receive" subtitle="Your wallet address">
      <WalletQr />
    </AppShell>
  );
}

function WalletQr() {
  const walletState = usePrivyWallet();
  const { ready, authenticated } = walletState;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const wallet = walletState.selectedWallet;

  if (!ready || !walletState.ready) {
    return <Card className="h-72 animate-pulse"><span className="sr-only">Loading wallet</span></Card>;
  }

  if (!authenticated || !wallet) {
    return (
      <EmptyState
        icon={Wallet}
        title={authenticated ? 'Choose a wallet first' : 'Connect a wallet first'}
        body="Connect or choose a wallet to show its receive address."
        action={<Link href="/login" className="button button-primary glass-press flex min-h-12 w-full items-center justify-center rounded-lg px-4 py-3 text-[15px] font-semibold">{authenticated ? 'Choose wallet' : 'Connect wallet'}</Link>}
      />
    );
  }

  const address = wallet.address;
  const copy = async () => {
    setCopyFailed(false);
    if (await copyText(address)) {
      haptic('success');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      haptic('error');
      setCopyFailed(true);
    }
  };

  return (
    <div className={styles.utilityWorkspace}>
      <Card className={`${styles.utilityCard} flex flex-col items-center gap-4 p-5`}>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <QRCodeSVG value={address} size={208} level="M" title="Your EVM wallet address" />
        </div>
        <div className="w-full">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-mut">Receive address</p>
              <p className="mt-0.5 text-[13px] font-semibold">Ethereum · Base</p>
            </div>
            <button type="button" onClick={copy} aria-label={copied ? 'Address copied' : 'Copy wallet address'} className="glass glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl p-2.5">
              {copied ? <Check className="h-[18px] w-[18px] text-success" aria-hidden="true" /> : <Copy className="h-[18px] w-[18px] text-mut" aria-hidden="true" />}
            </button>
          </div>
          <p className="mt-3 break-all rounded-2xl border border-[var(--line)] bg-[var(--input)] p-3 font-mono text-[12px] leading-relaxed">{address}</p>
        </div>
        <p className={`min-h-4 text-center text-[11px] ${copyFailed ? 'text-danger' : 'text-mut'}`} aria-live="polite">
          {copyFailed ? 'Copy was blocked. Press and hold the address to copy it manually.' : copied ? 'Address copied to clipboard.' : ''}
        </p>
      </Card>

      <Card className="flex items-start gap-2.5 border-[rgba(255,194,75,0.3)] p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <p className="text-[12px] leading-relaxed text-mut"><span className="font-medium text-warn">Check the network before sending.</span> Only send supported assets on Ethereum or Base.</p>
      </Card>
    </div>
  );
}
