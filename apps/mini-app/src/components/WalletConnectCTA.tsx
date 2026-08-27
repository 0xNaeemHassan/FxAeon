'use client';

import Link from 'next/link';
import { WalletCards } from 'lucide-react';
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
}: {
  ready: boolean;
  authenticated: boolean;
  body: string;
}) {
  const timedOut = useWalletReadyTimeout(ready);

  if (!ready) {
    if (timedOut) {
      return (
        <div role="alert"><Card className="border-[rgba(255,194,102,.24)] p-4">
          <p className="text-[14px] font-semibold">Wallet provider did not load</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mut">Check your connection, update Telegram, or reopen FxAeon. No wallet state or balance has been assumed.</p>
          <button type="button" onClick={() => window.location.reload()} className="button button-primary mt-3 min-h-11 w-full rounded-2xl px-4 text-[13px] font-semibold">Reload wallet provider</button>
        </Card></div>
      );
    }
    return (
      <Card className="h-24 animate-pulse" aria-label="Loading wallet state">
        <span className="sr-only">Loading wallet state</span>
      </Card>
    );
  }

  const title = authenticated ? 'Choose a wallet' : 'Connect your wallet';
  const action = authenticated ? 'Choose wallet' : 'Connect wallet';

  return (
    <Card className="border-[rgba(255,194,102,.24)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
          <WalletCards className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{title}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mut">{body}</p>
          <Link
            href="/login"
            className="button button-primary glass-press mt-3 flex min-h-11 w-full items-center justify-center rounded-2xl px-4 py-2.5 text-[13px] font-semibold"
          >
            {action}
          </Link>
        </div>
      </div>
    </Card>
  );
}
