'use client';

/**
 * Entry router.
 *
 * Telegram is the launch surface; Privy is the identity and wallet authority.
 * There is deliberately no account/API probe here. The first screen must not
 * depend on a FxAeon server being alive, and the portfolio page can show the
 * correct connect/read-only state from the client SDK.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { hasTelegramLaunchSignal, isTMA, waitForTelegramWebApp } from '@/lib/telegram';
import { ButtonLink, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot/app';

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const [browser, setBrowser] = useState(false);
  const [telegramUnavailable, setTelegramUnavailable] = useState(false);

  useEffect(() => {
    document.title = 'FxAeon · f(x) Protocol';
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (isTMA()) {
      router.replace('/portfolio');
      return () => { cancelled = true; };
    }
    if (!hasTelegramLaunchSignal()) {
      setBrowser(true);
      return () => { cancelled = true; };
    }

    void waitForTelegramWebApp().then((webApp) => {
      if (cancelled) return;
      if (webApp && isTMA()) router.replace('/portfolio');
      else setTelegramUnavailable(true);
    });
    return () => { cancelled = true; };
  }, [router]);

  if (telegramUnavailable) {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[rgba(255,194,102,.10)] text-warn">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-display mt-5 text-[24px] font-semibold">Telegram bridge unavailable</h1>
        <p className="mt-2 max-w-[330px] text-[14px] leading-relaxed text-mut">
          FxAeon could not connect to Telegram’s Mini App environment. Check your connection, update Telegram if needed, then reload.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload FxAeon
        </button>
      </main>
    );
  }

  if (browser) {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <div className="flex w-full flex-col items-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[20px] border border-[var(--line)] bg-[var(--surface-2)]">
            <FxLogo size={58} />
          </div>
          <h1 className="text-display mt-5 text-[36px] font-semibold leading-none tracking-[-0.05em]">
            Fx<span className="text-gradient">Aeon</span>
          </h1>
          <p className="mt-4 max-w-[320px] text-[14px] leading-relaxed text-mut">
            Trade, borrow, earn, and move f(x) assets from Telegram.
          </p>
          <ButtonLink href={TELEGRAM_APP_URL} external className="w-full">
            {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <p className="mt-4 inline-flex items-center gap-2 text-[12.5px] leading-relaxed text-[var(--mut-2)]">
            <ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" />
            You approve every wallet action.
          </p>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner asMain />;
}
