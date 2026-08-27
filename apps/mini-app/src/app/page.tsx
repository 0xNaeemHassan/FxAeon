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
import { AlertTriangle, ArrowLeftRight, ArrowUpRight, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
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
    document.title = 'FxAeon — f(x) Protocol Gateway';
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
        <p className="mt-2 max-w-[330px] text-[13px] leading-relaxed text-mut">
          FxAeon could not load Telegram’s Mini App bridge. Check your connection, update Telegram if needed, then reload.
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
        <div className="stagger flex w-full flex-col items-center">
          <span className="glass mb-7 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut">
            <span className="status-dot" aria-hidden="true" /> Built for Telegram
          </span>
          <div className="brand-orbit anim-float">
            <FxLogo size={58} />
          </div>
          <h1 className="text-display mt-7 text-[40px] font-semibold leading-none tracking-[-0.055em]">
            Fx<span className="text-gradient">Aeon</span>
          </h1>
          <p className="mt-4 max-w-[340px] text-[14px] leading-relaxed text-mut">{t('splash.tagline')}</p>

          <div className="my-7 grid w-full grid-cols-3 gap-2" aria-label="Product highlights">
            {[
              { icon: ShieldCheck, label: 'Self-custody' },
              { icon: Sparkles, label: 'Trade & earn' },
              { icon: ArrowLeftRight, label: 'Bridge both ways' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="glass flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl px-2">
                <Icon className="h-4 w-4 text-mint" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-[10px] font-medium text-mut">{label}</span>
              </div>
            ))}
          </div>

          <ButtonLink href={TELEGRAM_APP_URL} external className="w-full">
            {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <p className="mt-4 text-[10.5px] uppercase tracking-[0.14em] text-[var(--mut-2)]">
            Powered by f(x) Protocol · Ethereum + Base
          </p>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner asMain />;
}
