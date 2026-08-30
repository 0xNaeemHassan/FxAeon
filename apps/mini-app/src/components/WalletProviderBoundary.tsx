'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Globe2, RefreshCw } from 'lucide-react';
import { FullScreenSpinner } from '@/components/ui';
import { getWebApp, hasTelegramLaunchSignal, waitForTelegramWebApp } from '@/lib/telegram';

// Keep Privy and its wallet-connector graph out of the public browser landing
// chunk. Every wallet-capable route still shares exactly one provider mounted
// above its page tree.
const PrivyClientProvider = dynamic(
  () => import('@/components/PrivyClientProvider'),
  { loading: () => <FullScreenSpinner /> },
);

// Keep the direct-route launch gate comfortably inside Telegram's native
// startup budget. A failed script should resolve to a recovery screen instead
// of leaving the user on an indefinite loading state while the wallet chunk
// hydrates.
const TELEGRAM_BRIDGE_TIMEOUT_MS = 3_000;

export default function WalletProviderBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [telegramBridge, setTelegramBridge] = useState<'ready' | 'waiting' | 'unavailable'>(() => {
    if (getWebApp() || !hasTelegramLaunchSignal()) return 'ready';
    return 'waiting';
  });

  useEffect(() => {
    if (telegramBridge !== 'waiting') return;
    let cancelled = false;
    void waitForTelegramWebApp(TELEGRAM_BRIDGE_TIMEOUT_MS).then((webApp) => {
      if (!cancelled) setTelegramBridge(webApp ? 'ready' : 'unavailable');
    });
    return () => { cancelled = true; };
  }, [telegramBridge]);

  if (pathname === '/') return <>{children}</>;
  if (telegramBridge === 'waiting') return <FullScreenSpinner />;
  if (telegramBridge === 'unavailable') {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[rgba(255,194,102,.10)] text-warn">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-display mt-5 text-[24px] font-semibold">Telegram bridge unavailable</h1>
        <p className="mt-2 max-w-[330px] text-[13px] leading-relaxed text-mut">
          FxAeon could not load Telegram’s Mini App bridge. Check your connection, update Telegram if needed, then reload.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload FxAeon
        </button>
        <button
          type="button"
          onClick={() => window.location.assign(pathname ?? '/portfolio')}
          className="button button-ghost glass-press mt-2 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold"
        >
          <Globe2 className="h-4 w-4" aria-hidden="true" /> Continue in browser
        </button>
      </main>
    );
  }
  return <PrivyClientProvider>{children}</PrivyClientProvider>;
}
