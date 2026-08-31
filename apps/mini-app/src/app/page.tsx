'use client';

/**
 * Entry router.
 *
 * Web and Telegram are equal launch surfaces; Privy is the identity and
 * wallet authority.
 * There is deliberately no account/API probe here. The first screen must not
 * depend on a FxAeon server being alive, and the portfolio page can show the
 * correct connect/read-only state from the client SDK.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CandlestickChart,
  Globe2,
  Layers3,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { hasTelegramLaunchSignal, isTMA, waitForTelegramWebApp } from '@/lib/telegram';
import { ButtonLink, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot/app';
const CAPABILITIES = [
  { icon: CandlestickChart, title: 'Trade', copy: 'Open and manage positions' },
  { icon: Layers3, title: 'Borrow', copy: 'Mint, repay, and withdraw' },
  { icon: PiggyBank, title: 'fxSAVE', copy: 'Deposit, redeem, and claim' },
  { icon: ArrowLeftRight, title: 'Bridge', copy: 'Ethereum ↔ Base' },
] as const;

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
        <button
          type="button"
          onClick={() => window.location.assign('/portfolio')}
          className="button button-ghost glass-press mt-2 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold"
        >
          <Globe2 className="h-4 w-4" aria-hidden="true" /> Continue in browser
        </button>
      </main>
    );
  }

  if (browser) {
    return (
      <main className="min-h-[100dvh] w-full px-5 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto flex w-full max-w-[980px] flex-col">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface-2)]">
                <FxLogo size={32} />
              </span>
              <span className="text-display text-[20px] font-semibold tracking-tight">Fx<span className="text-gradient">Aeon</span></span>
            </div>
            <ButtonLink href={TELEGRAM_APP_URL} external variant="ghost" className="!min-h-11 !w-auto !px-3 !text-[13px]">
              Telegram <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </header>

          <div className="grid flex-1 items-center gap-10 py-12 md:grid-cols-[1.05fr_.95fr] md:py-16">
            <section className="text-left">
              <p className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-mint">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> f(x) protocol · Ethereum + Base
              </p>
              <h1 className="text-display mt-5 max-w-[620px] text-[42px] font-semibold leading-[1.02] tracking-[-0.055em] sm:text-[58px]">
                Trade, borrow, earn, <span className="text-gradient">move.</span>
              </h1>
              <p className="mt-5 max-w-[570px] text-[15px] leading-relaxed text-mut sm:text-[17px]">
                A focused f(x) experience for your browser or Telegram. Review every action, then approve it in your wallet.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/portfolio" className="sm:!w-auto sm:!px-6">
                  <Globe2 className="h-[18px] w-[18px]" aria-hidden="true" /> Launch web app <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
                <ButtonLink href={TELEGRAM_APP_URL} external variant="outline" className="sm:!w-auto sm:!px-6">
                  {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[var(--mut-2)]">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" /> Wallet-confirmed actions</span>
                <span className="inline-flex items-center gap-1.5"><Globe2 className="h-4 w-4 text-mint" aria-hidden="true" /> Browser or Telegram</span>
                <span className="inline-flex items-center gap-1.5"><WalletCards className="h-4 w-4 text-mint" aria-hidden="true" /> Your wallet, your keys</span>
              </div>
            </section>

            <section aria-label="FxAeon capabilities" className="glass relative overflow-hidden rounded-[28px] p-5 sm:p-6">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[rgba(139,109,255,.16)] blur-3xl" aria-hidden="true" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-mut">Your next move</p>
                    <h2 className="text-display mt-1.5 text-[22px] font-semibold">Everything in one place</h2>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)]"><FxLogo size={27} /></span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  {CAPABILITIES.map(({ icon: Icon, title, copy }) => (
                    <div key={title} className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-4">
                      <Icon className="h-5 w-5 text-mint" aria-hidden="true" />
                      <p className="mt-3 text-[14px] font-semibold">{title}</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-mut">{copy}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-[rgba(107,230,184,.20)] bg-[var(--success-dim)] px-4 py-3">
                  <span className="text-[12px] font-medium text-success">Ready when you are</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-success">Ethereum · Base</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner asMain />;
}
