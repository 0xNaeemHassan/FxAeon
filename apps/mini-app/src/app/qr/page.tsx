'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { AppShell, Card, copyText } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/UtilitySurfaces.module.css';
import WalletConnectCTA from '@/components/WalletConnectCTA';

/**
 * Receive screen. The address is read from the selected Privy wallet only;
 * query strings, Telegram user IDs, and server responses never get to choose
 * a deposit destination.
 */
export default function QRPage() {
  return (
    <AppShell title="Receive" subtitle="Receive tokens to your wallet">
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

  if (!ready || !walletState.ready || !authenticated || !wallet) {
    return <WalletConnectCTA
      compact
      ready={ready && walletState.ready}
      authenticated={authenticated}
      body={authenticated ? 'Choose a wallet to show its receive address.' : 'Connect a wallet to show its receive address.'}
    />;
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
    <div className={`${styles.utilityWorkspace} ${styles.qrWorkspace}`}>
      <Card className={`${styles.utilityCard} flex flex-col items-center gap-4 p-5`}>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm">
          <QRCodeSVG value={address} size={208} level="M" title="Your EVM wallet address for Ethereum or Base" />
        </div>
        <div className="w-full">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-mut">Wallet address</p>
              <p className="mt-0.5 text-[13px] font-semibold">Ethereum · Base supported</p>
            </div>
            <button type="button" onClick={copy} aria-label={copied ? 'Address copied' : 'Copy wallet address'} className="glass glass-press flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-semibold text-mut">
              {copied ? <Check className="h-[18px] w-[18px] text-success" aria-hidden="true" /> : <Copy className="h-[18px] w-[18px] text-mut" aria-hidden="true" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <p title="Select this address to copy it manually" className="mt-3 select-all break-all rounded-2xl border border-[var(--line)] bg-[var(--input)] p-3 font-mono text-[12px] leading-relaxed">{address}</p>
        </div>
        <p className={`min-h-4 text-center text-[11px] ${copyFailed ? 'text-danger' : 'text-mut'}`} aria-live="polite">
          {copyFailed ? 'Copy was blocked. Press and hold the address to copy it.' : copied ? 'Address copied to clipboard.' : ''}
        </p>
      </Card>

      <Card className="flex items-start gap-2.5 border-[rgba(255,194,75,0.3)] p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <p className="text-[12px] leading-relaxed text-mut"><span className="font-medium text-warn">Check the network before sending.</span> Use Ethereum or Base, then confirm the token is supported on that network.</p>
      </Card>
    </div>
  );
}
