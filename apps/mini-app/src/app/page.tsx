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
import Link from 'next/link';
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
} from 'lucide-react';
import { hasTelegramLaunchSignal, isTMA, waitForTelegramWebApp } from '@/lib/telegram';
import { ButtonLink, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import FxLogo from '@/components/FxLogo';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import ThemeToggle from '@/components/ThemeToggle';
import styles from '@/components/Welcome.module.css';

const TELEGRAM_APP_URL = process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || 'https://t.me/FxAeonBot';
const CAPABILITIES = [
  { icon: CandlestickChart, title: 'Trade', copy: 'ETH & BTC. Long or short.', href: '/trade' },
  { icon: PiggyBank, title: 'Earn', copy: 'Put fxSAVE to work.', href: '/earn' },
  { icon: Layers3, title: 'Borrow', copy: 'Unlock fxUSD from collateral.', href: '/borrow' },
  { icon: ArrowLeftRight, title: 'Move', copy: 'Ethereum. Base. Connected.', href: '/move' },
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
      <main className={styles.welcome}>
        <div className={styles.frame}>
          <header className={styles.nav}>
            <div className={styles.brand}>
              <FxLogo size={36} />
              <span className="brand-wordmark">FxAeon</span>
            </div>
            <div className={styles.navActions}>
              <ThemeToggle />
              <ButtonLink href={TELEGRAM_APP_URL} external variant="ghost" className="!w-auto !px-4">
                Telegram <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </ButtonLink>
            </div>
          </header>

          <div className={styles.heroGrid}>
            <section className={styles.hero}>
              <p className={styles.eyebrow}><span className="status-dot" /> Powered by f(x) Protocol</p>
              <h1>Your next move.<br /><span className="text-gradient">On your terms.</span></h1>
              <p className={styles.lede}>
                Trade ETH and BTC. Put your assets to work.
                Move between Ethereum and Base — all in one place.
              </p>
              <div className={styles.actions}>
                <ButtonLink href="/portfolio" className="!w-auto !px-7">
                  Launch web app <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
                <ButtonLink href={TELEGRAM_APP_URL} external variant="outline" className="!w-auto !px-6">
                  {t('common.openInTelegram')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
              </div>
            </section>

            <section aria-label="Explore FxAeon" className={styles.explore}>
              <div className={styles.exploreTop}>
                <span className={styles.assetStack}><TokenIcon symbol="ETH" size={36} /><TokenIcon symbol="WBTC" size={36} /><TokenIcon symbol="fxUSD" size={36} /></span>
                <span>More possibilities.<br /><strong>One place.</strong></span>
              </div>
              <div className={styles.productGrid}>
                {CAPABILITIES.map(({ icon: Icon, title, copy, href }) => (
                  <Link key={title} href={href} className={styles.product}>
                    <span className={styles.productTop}><Icon aria-hidden="true" /><ArrowUpRight aria-hidden="true" /></span>
                    <strong>{title}</strong><small>{copy}</small>
                  </Link>
                ))}
              </div>
              <div className={styles.networks}><span><ChainIcon chainId={1} size={20} /> Ethereum</span><ArrowLeftRight size={16} aria-hidden="true" /><span><ChainIcon chainId={8453} size={20} /> Base</span></div>
            </section>
          </div>

          <footer className={styles.footer}>
            <a href="https://x.com/0xWhizMiz" target="_blank" rel="noreferrer">Made by whiz ❤️</a>
            <span><Globe2 size={16} aria-hidden="true" /> Open on the web. At home in Telegram.</span>
          </footer>
        </div>
      </main>
    );
  }

  return <FullScreenSpinner asMain />;
}
