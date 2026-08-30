'use client';

import { useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { AppShell, Button, Card, copyText, EmptyState } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Receive screen. The address is read from the selected Privy wallet only;
 * query strings, Telegram user IDs, and server responses never get to choose
 * a deposit destination.
 */
export default function QRPage() {
  return (
    <AppShell title="Receive" subtitle="Your wallet address">
      {privyConfigured() ? <WalletQr /> : <EmptyState icon={Wallet} title="Wallet unavailable" body="Wallet access is not available right now, so no address can be shown." />}
    </AppShell>
  );
}

function WalletQr() {
  const { ready, authenticated } = usePrivy();
  const walletState = usePrivyWallet();
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
        action={<Link href="/login" className="button button-primary glass-press flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-[15px] font-semibold">{authenticated ? 'Choose wallet' : 'Connect wallet'}</Link>}
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
    <div className="flex flex-col gap-3.5">
      <Card className="flex flex-col items-center gap-4 p-5">
        <div className="rounded-[22px] bg-white p-3.5 shadow-[0_22px_50px_rgba(0,0,0,0.32)]">
          <QRCodeSVG value={address} size={208} level="M" title="Your EVM wallet address" />
        </div>
        <p className="text-center text-[12px] text-mut">Ethereum and Base</p>
      </Card>

      <Card>
        <p className="text-[11px] font-medium text-mut">Wallet address</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <p className="break-all font-mono text-[12px] leading-relaxed">{address}</p>
          <button type="button" onClick={copy} aria-label={copied ? 'Address copied' : 'Copy wallet address'} className="glass glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl p-2.5">
            {copied ? <Check className="h-[18px] w-[18px] text-success" aria-hidden="true" /> : <Copy className="h-[18px] w-[18px] text-mut" aria-hidden="true" />}
          </button>
        </div>
        <Button onClick={copy} variant="ghost" className="mt-3">{copied ? 'Copied' : 'Copy address'}</Button>
        <p className={`mt-2 min-h-4 text-center text-[11px] ${copyFailed ? 'text-danger' : 'text-mut'}`} aria-live="polite">
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
