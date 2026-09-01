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
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot';
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

    void waitForTelegramWebApp(8_000).then((webApp) => {
      if (cancelled) return;
      if (webApp && isTMA()) router.replace('/portfolio');
      else setTelegramUnavailable(true);
    });
    return () => { cancelled = true; };
  }, [router]);

  if (telegramUnavailable) {
    return (
      <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-[rgba(255,194,102,.10)] text-warn">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-display mt-5 text-[24px] font-semibold">Telegram bridge unavailable</h1>
        <p className="mt-2 max-w-[330px] text-[14px] leading-relaxed text-mut">
          FxAeon could not connect to Telegram’s Mini App environment. Check your connection, update Telegram if needed, then reload.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-lg px-4 py-3 text-[14px] font-semibold">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload FxAeon
        </button>
        <button
          type="button"
          onClick={() => window.location.assign('/portfolio')}
          className="button button-ghost glass-press mt-2 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-lg px-4 py-3 text-[14px] font-semibold"
        >
          <Globe2 className="h-4 w-4" aria-hidden="true" /> Continue in browser
        </button>
      </main>
    );
  }

  if (browser) {
    return (
      <main className="landing-shell">
        <div className="landing-frame">
          <header className="landing-nav">
            <div className="landing-brand">
              <span className="landing-brand-mark"><FxLogo size={30} /></span>
              <span><strong>FxAeon</strong><small>Ethereum interface</small></span>
            </div>
            <div className="landing-nav-actions">
              <span className="landing-live"><span className="status-dot" /> Ethereum</span>
              <ButtonLink href={TELEGRAM_APP_URL} external variant="ghost" className="!min-h-10 !w-auto !px-3 !text-[12px]">
                Telegram <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </ButtonLink>
            </div>
          </header>

          <div className="landing-grid">
            <section className="landing-hero">
              <p className="landing-kicker"><span>01</span> Wallet-controlled markets</p>
              <h1>One interface.<br /><span className="text-gradient">Every f(x) move.</span></h1>
              <p className="landing-lede">
                Trade positions, mint fxUSD, manage fxSAVE, and move fxUSD between Ethereum and Base. Review each action, then confirm it in your wallet.
              </p>
              <div className="landing-actions">
                <ButtonLink href="/portfolio" className="!w-auto !px-6">
                  Launch web app <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
                <ButtonLink href={TELEGRAM_APP_URL} external variant="outline" className="!w-auto !px-6">
                  {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
              </div>
              <div className="landing-assurance">
                <span><ShieldCheck aria-hidden="true" /> Wallet-confirmed</span>
                <span><Globe2 aria-hidden="true" /> Web or Telegram</span>
                <span><WalletCards aria-hidden="true" /> Your wallet signs</span>
              </div>
            </section>

            <section aria-label="FxAeon protocol workspace preview" className="landing-terminal">
              <div className="terminal-header">
                <span>Protocol workspace</span>
                <span className="terminal-status"><span className="status-dot" /> Ready</span>
              </div>
              <div className="network-route" aria-label="Ethereum to Base route">
                <div className="network-node"><ChainIcon chainId={1} size={30} /><span><strong>Ethereum</strong><small>Source</small></span></div>
                <span className="route-line" aria-hidden="true"><i /><i /></span>
                <div className="network-node network-node-aeon"><FxLogo size={30} /><span><strong>FxAeon</strong><small>Review</small></span></div>
                <span className="route-line" aria-hidden="true"><i /><i /></span>
                <div className="network-node"><ChainIcon chainId={8453} size={30} /><span><strong>Base</strong><small>Destination</small></span></div>
              </div>
              <div className="terminal-assets">
                <span><TokenIcon symbol="fxUSD" size={24} /><TokenIcon symbol="fxSAVE" size={24} /></span>
                <span><strong>Protocol assets</strong><small>fxUSD and fxSAVE</small></span>
              </div>
              <div className="terminal-capabilities">
                {CAPABILITIES.map(({ icon: Icon, title, copy }, index) => (
                  <div key={title} className="terminal-row">
                    <span className="terminal-index">0{index + 1}</span>
                    <Icon className="h-[18px] w-[18px] text-mint" aria-hidden="true" />
                    <span><strong>{title}</strong><small>{copy}</small></span>
                    <ArrowRight className="ml-auto h-4 w-4 text-[var(--mut-2)]" aria-hidden="true" />
                  </div>
                ))}
              </div>
              <div className="terminal-footer"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Every action is wallet-confirmed</div>
            </section>
          </div>

          <footer className="landing-footer">
            <span>FxAeon / Ethereum-native interface</span>
            <span>Reviewable · Wallet-confirmed · Built for web and Telegram</span>
          </footer>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner asMain />;
}
