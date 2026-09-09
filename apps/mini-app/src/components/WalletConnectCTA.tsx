'use client';

import { WalletCards } from 'lucide-react';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { Card } from '@/components/ui';
import { useWalletReadyTimeout } from '@/lib/wallet';

/**
 * Shared no-wallet state for protocol screens.
 *
 * Authentication and wallet selection are separate Privy states: an
 * authenticated account may still need to create or connect a wallet. Keep
 * that distinction visible so users always know which action is next.
 */
export default function WalletConnectCTA({
  ready,
  authenticated,
  body,
  compact = false,
}: {
  ready: boolean;
  authenticated: boolean;
  body: string;
  compact?: boolean;
}) {
  const timedOut = useWalletReadyTimeout(ready);

  if (!ready) {
    if (timedOut) {
      return (
        <div role="alert"><Card className={`border-[rgba(255,194,102,.24)] ${compact ? 'p-3' : 'p-4'}`}>
          <p className="text-[14px] font-semibold">Wallet provider did not load</p>
          <p className="mt-1 text-[12px] leading-relaxed text-mut">Try again shortly.</p>
          <button type="button" onClick={() => window.location.reload()} className={`button button-primary min-h-11 w-full rounded-xl px-4 text-[13px] font-semibold ${compact ? 'mt-2' : 'mt-3'}`}>Reload wallet</button>
        </Card></div>
      );
    }
    return (
      <div role="status" aria-live="polite">
        <Card className={`${compact ? 'h-16' : 'h-24'} animate-pulse`}>
          <span className="sr-only">Loading wallet state</span>
        </Card>
      </div>
    );
  }

  const title = authenticated ? 'Choose a wallet' : 'Connect your wallet';
  const action = authenticated ? 'Choose wallet' : 'Connect wallet';

  if (compact) {
    return (
      <Card className="wallet-connect-cta wallet-connect-cta-compact flex items-center gap-2.5 rounded-2xl border-[rgba(255,194,102,.24)] p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <WalletCards className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          <p className="mt-0.5 truncate text-[11px] text-mut">{body}</p>
        </div>
        <ConnectWalletButton
          aria-label={action}
          className="button button-primary glass-press flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-[11px] font-semibold"
        >
          {action}
        </ConnectWalletButton>
      </Card>
    );
  }

  return (
    <Card className="wallet-connect-cta border-[rgba(255,194,102,.24)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <WalletCards className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{title}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mut">{body}</p>
          <ConnectWalletButton
            className="button button-primary glass-press mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
          >
            {action}
          </ConnectWalletButton>
        </div>
      </div>
    </Card>
  );
}
